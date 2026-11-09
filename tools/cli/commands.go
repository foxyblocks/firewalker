// Boot lifecycle commands share selection here. Discovery refreshes IDs before
// resolving the full target list; only then may a command blink, install, or
// open diagnostic connections. USB serials remain the hardware identity even
// when a reconnect changes the port path.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/pickboot"
	"firewalker/cli/internal/theme"
)

func addTargetFlags(cmd *cobra.Command) {
	f := cmd.PersistentFlags()
	f.StringSlice("boot", nil, "Boot ID, USB serial, or port; repeat or separate with commas")
	f.Bool("all", false, "Select every connected boot without a menu")
	f.Bool("headless", false, "Never open a terminal menu; requires boot identifiers or --all")
}

// selectBoots never prompts a script or silently selects a lone board. A person
// with no identifiers gets the same Space-to-select menu for every action.
func selectBoots(cmd *cobra.Command, o *bench.Options) ([]boots.Boot, error) {
	selection, err := resolveBootSelection(cmd, o)
	if err != nil {
		return nil, err
	}
	if selection.Menu {
		return pickboot.Run(cmd.Context(), cmd.CommandPath(), selection.Boots, cmd.InOrStdin(), cmd.OutOrStdout())
	}
	return selection.Boots, nil
}

type bootSelection struct {
	Boots []boots.Boot
	Menu  bool
}

// resolveBootSelection separates target lookup from terminal behavior. Commands
// that perform repeatable actions keep the available boots in their menu, while
// install and the live dashboard consume one selection before opening their UI.
func resolveBootSelection(cmd *cobra.Command, o *bench.Options) (bootSelection, error) {
	names, _ := cmd.Flags().GetStringSlice("boot")
	names = append(append([]string(nil), cmd.Flags().Args()...), names...)
	if o != nil {
		if err := o.CheckTarget(); err != nil {
			return bootSelection{}, err
		}
		if o.Serial != "" {
			names = append(names, o.Serial)
		}
		if o.Port != "" {
			names = append(names, o.Port)
		}
	}
	all, _ := cmd.Flags().GetBool("all")
	headless, _ := cmd.Flags().GetBool("headless")
	asJSON, _ := cmd.Flags().GetBool("json")
	interactive := term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
	if len(names) == 0 && !all && (headless || asJSON || !interactive) {
		return bootSelection{}, fmt.Errorf("choose boots with --boot ID, positional identifiers, or --all; omit identifiers in a terminal for the selection menu")
	}
	if all && len(names) > 0 {
		return bootSelection{}, fmt.Errorf("use --all or boot identifiers, not both")
	}
	connected, err := boots.NewInventory(openCache()).Scan(cmd.Context())
	if err != nil {
		return bootSelection{}, err
	}
	selected, err := boots.Resolve(connected, names, all)
	if err != nil {
		return bootSelection{}, err
	}
	if len(names) != 0 || all {
		return bootSelection{Boots: selected}, nil
	}
	return bootSelection{Boots: connected, Menu: true}, nil
}

func addDeviceCommands(root *cobra.Command, opts *bench.Options) {
	root.AddCommand(newListCommand(), newIdentifyCommand(), newDebugCommand(opts))
}

func newListCommand() *cobra.Command {
	cmd := &cobra.Command{Use: "list", Short: "List connected boots, their IDs, USB serials, and firmware status", Args: cobra.NoArgs}
	cmd.Flags().Bool("json", false, "Print the inventory as JSON")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		connected, err := boots.NewInventory(openCache()).Scan(cmd.Context())
		if err != nil {
			return err
		}
		asJSON, _ := cmd.Flags().GetBool("json")
		if asJSON {
			if connected == nil {
				connected = []boots.Boot{}
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(connected)
		}
		if len(connected) == 0 {
			fmt.Fprintln(cmd.OutOrStdout(), "No MG24 on USB. Connect a board with a data cable.")
			return nil
		}
		out := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
		fmt.Fprintln(out, "BOOT\tUSB SERIAL\tPORT\tFIRMWARE")
		for _, b := range connected {
			state := b.Problem
			if b.Status != nil {
				state = fmt.Sprintf("app · protocol %d · %s", b.Status.Proto, b.Status.Pattern)
			}
			if b.Remembered {
				state += " (remembered ID)"
			}
			fmt.Fprintf(out, "%s\t%s\t%s\t%s\n", b.Name(), b.Serial, b.Port, state)
		}
		return out.Flush()
	}
	return cmd
}

type actionResult struct {
	ID     string `json:"id"`
	Serial string `json:"serial"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

func newIdentifyCommand() *cobra.Command {
	cmd := &cobra.Command{Use: "identify [boot...]", Short: "Blink the selected boots for about 1.5 seconds", Args: cobra.ArbitraryArgs}
	addTargetFlags(cmd)
	cmd.Flags().Bool("json", false, "Print acknowledgments as JSON")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		selection, err := resolveBootSelection(cmd, nil)
		if err != nil {
			return err
		}
		if selection.Menu {
			return pickboot.RunAction(cmd.Context(), cmd.CommandPath(), selection.Boots, cmd.InOrStdin(), cmd.OutOrStdout(), func(ctx context.Context, selected []boots.Boot, progress func(string)) (string, error) {
				progress("Blinking selected boots…")
				results, err := identifyBoots(ctx, selected)
				var acknowledged []string
				for _, result := range results {
					if result.OK {
						acknowledged = append(acknowledged, result.ID)
					}
				}
				message := ""
				if len(acknowledged) > 0 {
					message = "Blink acknowledged: " + strings.Join(acknowledged, ", ") + ". Press Enter to blink again."
				}
				return message, err
			})
		}
		results, runErr := identifyBoots(cmd.Context(), selection.Boots)
		asJSON, _ := cmd.Flags().GetBool("json")
		for _, result := range results {
			if !asJSON {
				if !result.OK {
					fmt.Fprintf(cmd.OutOrStdout(), "%s FAIL — %s\n", result.ID, result.Error)
				} else {
					fmt.Fprintf(cmd.OutOrStdout(), "%s — identify blink acknowledged\n", result.ID)
				}
			}
		}
		if asJSON {
			if err := json.NewEncoder(cmd.OutOrStdout()).Encode(results); err != nil {
				return err
			}
		}
		return runErr
	}
	return cmd
}

// Both interactive repeats and one-shot scripts use the same acknowledged USB
// action. Every attempt closes its connection before the next run can begin.
func identifyBoots(ctx context.Context, selected []boots.Boot) ([]actionResult, error) {
	results := make([]actionResult, 0, len(selected))
	var problems []error
	for _, b := range selected {
		err := ctx.Err()
		if err == nil {
			err = identifyBoot(ctx, b)
		}
		result := actionResult{ID: b.Name(), Serial: b.Serial, OK: err == nil}
		if err != nil {
			result.Error = err.Error()
			problems = append(problems, fmt.Errorf("%s: %w", b.Name(), err))
		}
		results = append(results, result)
	}
	return results, errors.Join(problems...)
}

func identifyBoot(ctx context.Context, b boots.Boot) error {
	transport, err := link.ForBoard(b.Serial)()
	if err != nil {
		return err
	}
	defer transport.Close()
	status, err := link.AwaitStatus(ctx, transport, statusTimeout)
	if err != nil {
		return err
	}
	if b.ID != "" && status.ID != b.ID {
		return fmt.Errorf("boot ID changed from %s to %s; run ./cli list again", b.ID, status.ID)
	}
	return link.Command(ctx, transport, "identify", statusTimeout)
}

func newInstallCommand(opts *bench.Options) *cobra.Command {
	cmd := &cobra.Command{Use: "install [boot...]", Short: "Install the shoe app, or a one-off strip test, on selected boots", Args: cobra.ArbitraryArgs}
	addTargetFlags(cmd)
	cmd.PersistentFlags().String("firmware", flash.AppEnv, "Firmware build: final_app, imu_debug, strip_test, or strip_off")
	cmd.Flags().Bool("allow-downgrade", false, "Allow replacing newer app firmware with this checkout's older protocol")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		if err := refuseFlags(cmd, "firmware uses the boot's saved settings", "pixels", "brightness"); err != nil {
			return err
		}
		env, _ := cmd.Flags().GetString("firmware")
		valid := false
		for _, build := range flash.Builds {
			valid = valid || build.Env == env
		}
		if !valid {
			return fmt.Errorf("unknown firmware %q; use final_app, imu_debug, strip_test, or strip_off", env)
		}
		if err := opts.CheckTarget(); err != nil {
			return err
		}
		if opts.BuildOnly || opts.DryRun {
			return installFirmware(cmd, opts, env, nil)
		}
		selected, err := selectBoots(cmd, opts)
		if err != nil {
			return err
		}
		if opts.Debug && len(selected) > 1 {
			return fmt.Errorf("--follow supports one boot; install all selected boots first, then use ./cli debug for the live dashboard")
		}
		if env == flash.AppEnv {
			allow, _ := cmd.Flags().GetBool("allow-downgrade")
			// Check the whole batch before the first flash, so a later incompatible
			// boot cannot leave only part of the selection installed.
			for _, b := range selected {
				if b.Status != nil {
					if err := flash.CheckAppInstall(opts.RepoRoot, b.Status.Proto, allow); err != nil {
						return fmt.Errorf("%s: %w", b.Name(), err)
					}
				}
			}
		}
		var problems []error
		for _, b := range selected {
			if err := cmd.Context().Err(); err != nil {
				return err
			}
			perBoot := *opts
			perBoot.Serial, perBoot.Port = b.Serial, ""
			if err := installFirmware(cmd, &perBoot, env, &b); err != nil {
				problems = append(problems, fmt.Errorf("%s: %w", b.Name(), err))
			}
		}
		return errors.Join(problems...)
	}
	return cmd
}

func installFirmware(cmd *cobra.Command, opts *bench.Options, env string, target *boots.Boot) error {
	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "Install: %s | saved settings stay\n", env)
	job := flash.Job{RepoRoot: opts.RepoRoot, Env: env}
	var board *boards.Board
	if target != nil {
		board = &boards.Board{Serial: target.Serial, Port: target.Port}
	}
	return flashAndFollow(cmd.Context(), out, theme.New(out), openCache(), opts, job, board, env, opts.Debug)
}

// Each selected boot gets fresh copies of the build options: resolving the first
// boot's strip layout must not become an explicit override for the next one.
func runInstallTest(ctx context.Context, cmd *cobra.Command, opts *bench.Options, cfg *bench.Config) error {
	if cmd.Annotations["select-boots"] != "true" {
		return runTest(ctx, cmd, opts, cfg)
	}
	if err := refuseFlags(cmd, "strip tests choose their own firmware", "firmware"); err != nil {
		return err
	}
	if opts.BuildOnly || opts.DryRun {
		return runTest(ctx, cmd, opts, cfg)
	}
	if err := bench.CheckInputs(opts, cfg); err != nil {
		return err
	}
	selected, err := selectBoots(cmd, opts)
	if err != nil {
		return err
	}
	if (opts.Debug || cfg.LogMotion) && len(selected) > 1 {
		return fmt.Errorf("--follow and --log-motion support one boot at a time")
	}
	var problems []error
	for _, b := range selected {
		if err := ctx.Err(); err != nil {
			return err
		}
		perBoot, perTest := *opts, *cfg
		perBoot.Serial, perBoot.Port = b.Serial, ""
		if err := runTest(ctx, cmd, &perBoot, &perTest); err != nil {
			problems = append(problems, fmt.Errorf("%s: %w", b.Name(), err))
		}
	}
	return errors.Join(problems...)
}

// diagnosticFailures makes successful output and process failure agree: scripts
// get a nonzero exit status after every selected boot has printed its result.
func diagnosticFailures(names []string) error {
	if len(names) == 0 {
		return nil
	}
	return fmt.Errorf("diagnostics failed for %s", strings.Join(names, ", "))
}
