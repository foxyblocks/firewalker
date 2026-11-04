// cli is the local bench tool for the XIAO MG24 Sense: it builds a one-off strip
// test and flashes it to a USB-connected board, so bench work doesn't depend on the
// phone remote. Cobra handles arguments here; internal/bench owns what a test is and
// internal/boards owns which board it runs on. Flags become build flags for the `bench`
// PlatformIO environment (see src/modes/bench.cpp), so running a test never edits
// firmware sources and never touches a shoe's saved settings. To return a board to
// the app afterward, run `pio run -e final_app -t upload`.
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
)

const serialBaud = "115200"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if err := newCommand().ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "cli:", err)
		os.Exit(1)
	}
}

func newCommand() *cobra.Command {
	opts := &bench.Options{}
	root := &cobra.Command{
		Use: "cli", Short: "Build and run MG24 Sense strip tests on D10",
		Long:         "Run MG24 bench tests without editing firmware settings. Defaults: the strip length in include/config.h, brightness 16/255, data on D10. Each command builds and uploads; --build-only compiles without touching the board.",
		SilenceUsage: true, SilenceErrors: true,
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	f := root.PersistentFlags()
	f.StringVar(&opts.RepoRoot, "repo-root", "../..", "Firewalker repository root")
	_ = f.MarkHidden("repo-root")
	f.IntVar(&opts.Pixels, "pixels", 0, "Total connected pixels (1–4096); defaults to FIREWALKER_LED_COUNT in include/config.h")
	f.IntVar(&opts.Brightness, "brightness", 16, "Global brightness (1–255; not a current limit)")
	f.StringVar(&opts.Port, "port", "", "MG24 USB port; auto-detected when one board is connected")
	f.StringVar(&opts.Serial, "serial", "", "MG24 USB serial number; useful with multiple boards")
	f.BoolVar(&opts.BuildOnly, "build-only", false, "Compile without uploading")
	f.BoolVar(&opts.DryRun, "dry-run", false, "Show resolved settings without compiling or uploading")

	tests := []struct {
		name, short string
		test        int
	}{
		{"flow", "Run spectrum-cycling flow (no motion by default)", bench.TestFlow},
		{"fire-trail", "Launch fire trails on a timer, or from motion", bench.TestFireTrail},
		{"color", "Cycle white/red/green/blue, or show a fixed color", bench.TestColor},
		{"off", "Blank every connected pixel (power remains on)", bench.TestOff},
	}
	for _, t := range tests {
		cfg := &bench.Config{Name: t.name, Test: t.test, Toe: -1, Heel: -1, Lit: -1, Color: "cycle", Interval: 500 * time.Millisecond}
		cmd := &cobra.Command{Use: t.name, Short: t.short, Args: cobra.NoArgs}
		if cfg.IsPattern() {
			flags := cmd.Flags()
			flags.BoolVar(&cfg.Motion, "motion", false, "Use the onboard sensor for tilt and stomp input")
			flags.BoolVar(&cfg.LogMotion, "log-motion", false, "Stream motion logs over USB after flashing; Ctrl-C leaves the board running")
			flags.Float64Var(&cfg.Tilt, "tilt", 0, "Fixed simulated tilt (-1 heel-down, 0 level, +1 toe-down)")
			flags.DurationVar(&cfg.StompEvery, "stomp-every", 0, "Simulate impacts at this interval; 0 disables (fire-trail defaults to 1s without --motion)")
			flags.IntVar(&cfg.Toe, "toe", -1, "Toe pixel; defaults to config.h, or 32.5% of the strip with a custom --pixels")
			flags.IntVar(&cfg.Heel, "heel", -1, "Heel pixel; defaults to config.h, or 82.5% of the strip with a custom --pixels")
		}
		if t.test == bench.TestColor {
			cmd.Flags().IntVar(&cfg.Lit, "lit", -1, "Pixels to light at the input end; defaults to all")
			cmd.Flags().StringVar(&cfg.Color, "color", "cycle", "cycle, white, red, green, blue, or '#RRGGBB'")
			cmd.Flags().DurationVar(&cfg.Interval, "interval", 500*time.Millisecond, "Time per color in the cycle")
		}
		cmd.RunE = func(cmd *cobra.Command, _ []string) error {
			if cfg.Test == bench.TestFireTrail && !cfg.Motion && !cmd.Flags().Changed("stomp-every") {
				cfg.StompEvery = time.Second
			}
			// A custom strip length gets its layout scaled in Validate, because the
			// configured toe and heel only describe the configured length.
			if !cmd.Flag("pixels").Changed {
				layout, err := bench.ReadStripLayout(opts.RepoRoot)
				if err != nil {
					return err
				}
				opts.Pixels = layout.Pixels
				if cfg.Toe == -1 {
					cfg.Toe = layout.Toe
				}
				if cfg.Heel == -1 {
					cfg.Heel = layout.Heel
				}
			}
			if err := bench.Validate(opts, cfg); err != nil {
				return err
			}
			return runTest(cmd.Context(), cmd, opts, cfg)
		}
		root.AddCommand(cmd)
	}
	return root
}

func runTest(ctx context.Context, cmd *cobra.Command, o *bench.Options, c *bench.Config) error {
	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "Test: %s | pixels: %d | brightness: %d/255 | D10 | motion: %t\n", c.Name, o.Pixels, o.Brightness, c.Motion)
	if c.IsPattern() {
		fmt.Fprintf(out, "Layout: toe=%d heel=%d | simulated tilt: %.2f | timed impacts: %s\n", c.Toe, c.Heel, c.Tilt, c.StompEvery)
	}
	if o.DryRun {
		fmt.Fprintln(out, "Dry run: no compilation, upload, or firmware-source changes.")
		return nil
	}
	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("PlatformIO's pio command is required: %w", err)
	}

	args := []string{"run", "--project-dir", o.RepoRoot, "-e", "bench"}
	var target boards.Board
	if !o.BuildOnly {
		connected, err := boards.Discover(ctx)
		if err != nil {
			return err
		}
		target, err = boards.Select(connected, o.Port, o.Serial)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Target: %s (serial %s)\n", target.Port, target.Serial)
		args = append(args, "-t", "upload", "--upload-port", target.Serial)
	}

	// These apply only to the firmware's own sources, so switching tests recompiles
	// them without rebuilding the whole Silicon Labs core.
	build := exec.CommandContext(ctx, "pio", args...)
	build.Env = append(os.Environ(), "PLATFORMIO_BUILD_SRC_FLAGS="+strings.Join(bench.BuildFlags(o, c), " "))
	build.Stdout, build.Stderr = os.Stdout, os.Stderr
	if err := build.Run(); err != nil {
		return fmt.Errorf("pio run failed: %w", err)
	}

	if c.LogMotion {
		fmt.Fprintf(out, "Streaming motion logs from %s. Ctrl-C stops the stream and leaves the board running.\n", target.Port)
		monitor := exec.Command("pio", "device", "monitor", "--port", target.Port, "--baud", serialBaud)
		monitor.Stdin, monitor.Stdout, monitor.Stderr = os.Stdin, os.Stdout, os.Stderr
		// The monitor handles Ctrl-C itself, so ignore this command's own context here.
		if err := monitor.Run(); err != nil && ctx.Err() == nil {
			return fmt.Errorf("pio device monitor failed: %w", err)
		}
	}
	return nil
}
