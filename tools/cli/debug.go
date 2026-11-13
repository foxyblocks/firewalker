// debug routes the same selected boots to a live dashboard or a finite check.
// The dashboard owns its streaming sessions. Headless checks use diagnostics.Run,
// which plays tones once for all selected boots and restores debug before this
// file prints results. JSON stays on stdout; phase progress goes to stderr.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/diagnosticui"
	"firewalker/cli/internal/pickboot"
	"firewalker/cli/internal/theme"
)

func newDebugCommand(build *bench.Options) *cobra.Command {
	options := diagnostics.DefaultOptions()
	cmd := &cobra.Command{Use: "debug [boot...]", Short: "Watch live motion and microphone readings, or run headless checks", Args: cobra.ArbitraryArgs}
	addTargetFlags(cmd)
	f := cmd.PersistentFlags()
	f.Bool("json", false, "Run headless and print machine-readable results")
	f.DurationVar(&options.Duration, "duration", options.Duration, "Capture duration; for audio, the length of each quiet/tone window (1s–1m)")
	f.Float64Var(&options.Volume, "volume", options.Volume, "Generated tone amplitude (greater than 0, at most 1); system volume stays unchanged")
	f.Float64Var(&options.MinRatio, "min-ratio", options.MinRatio, "Minimum tone/background RMS ratio for audio PASS")
	f.Float64Var(&options.MinRise, "min-rise", options.MinRise, "Minimum tone increase in raw RMS counts for audio PASS")
	f.BoolVar(&options.RequireMovement, "require-movement", false, "Motion must change during capture, rather than only report plausible readings")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		return runDebug(cmd, build, options, diagnostics.All, true)
	}
	for _, kind := range []string{diagnostics.Audio, diagnostics.Motion} {
		short := "Play known tones and check the microphone's acoustic response"
		if kind == diagnostics.Motion {
			short = "Check fresh IMU readings; optionally require physical movement"
		}
		child := &cobra.Command{Use: kind + " [boot...]", Short: short, Args: cobra.ArbitraryArgs}
		child.RunE = func(cmd *cobra.Command, _ []string) error { return runDebug(cmd, build, options, kind, false) }
		cmd.AddCommand(child)
	}
	return cmd
}

func runDebug(cmd *cobra.Command, build *bench.Options, options diagnostics.Options, kind string, allowLive bool) error {
	options.Kind = kind
	if err := options.Validate(); err != nil {
		return err
	}
	if kind == diagnostics.Audio {
		if err := refuseFlags(cmd, "audio does not check motion", "require-movement"); err != nil {
			return err
		}
	}
	if kind == diagnostics.Motion {
		if err := refuseFlags(cmd, "motion does not play sound", "volume", "min-ratio", "min-rise"); err != nil {
			return err
		}
	}
	headless, _ := cmd.Flags().GetBool("headless")
	asJSON, _ := cmd.Flags().GetBool("json")
	live := allowLive && !headless && !asJSON
	if live && (!term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stdout.Fd()))) {
		return fmt.Errorf("the diagnostic TUI needs a terminal; use debug --headless, debug audio, or debug motion")
	}
	selection, err := resolveBootSelection(cmd, nil)
	if err != nil {
		return err
	}
	if live {
		selected := selection.Boots
		if selection.Menu {
			selected, err = pickboot.Run(cmd.Context(), cmd.CommandPath(), selected, cmd.InOrStdin(), cmd.OutOrStdout())
			if err != nil {
				return err
			}
		}
		return diagnosticui.Run(cmd.Context(), selected, cmd.InOrStdin(), cmd.OutOrStdout())
	}
	if selection.Menu {
		return pickboot.RunAction(cmd.Context(), cmd.CommandPath(), selection.Boots, cmd.InOrStdin(), cmd.OutOrStdout(), func(ctx context.Context, selected []boots.Boot, progress func(string)) (string, error) {
			report, err := runDiagnosticCheck(ctx, selected, options, progress)
			if len(report.Results) == 0 {
				return "", err
			}
			var result strings.Builder
			printDiagnosticReport(&result, report)
			return strings.TrimSpace(result.String()) + "\n  Press Enter to run again.", err
		})
	}
	report, runErr := runDiagnosticCheck(cmd.Context(), selection.Boots, options, func(phase string) { fmt.Fprintln(cmd.ErrOrStderr(), phase) })
	if runErr != nil && len(report.Results) == 0 {
		return runErr
	}
	if asJSON {
		encoder := json.NewEncoder(cmd.OutOrStdout())
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			return err
		}
	} else {
		printDiagnosticReport(cmd.OutOrStdout(), report)
	}
	if runErr != nil {
		return runErr
	}
	var failed []string
	for _, result := range report.Results {
		if !result.Pass {
			failed = append(failed, result.ID)
		}
	}
	return diagnosticFailures(failed)
}

// Menu repeats and headless commands execute the same finite check. Only the
// progress/result destination changes; no diagnostic writes around the TUI.
func runDiagnosticCheck(ctx context.Context, selected []boots.Boot, options diagnostics.Options, progress func(string)) (diagnostics.Report, error) {
	deps := diagnostics.Dependencies{}
	if options.Kind != diagnostics.Motion {
		player, err := diagnostics.SystemPlayer()
		if err != nil {
			return diagnostics.Report{}, err
		}
		deps.Player = player
		progress(fmt.Sprintf("Sound output: %s. Put selected boards near the speakers and pause other audio.", player.Name()))
	}
	if options.RequireMovement {
		progress("Move or tilt each selected boot during capture.")
	}
	return diagnostics.Run(ctx, selected, options, deps, progress)
}

func printDiagnosticReport(out io.Writer, report diagnostics.Report) {
	th := theme.New(out)
	for _, result := range report.Results {
		mark := th.OK.Render("PASS")
		if !result.Pass {
			mark = th.Error.Render("FAIL")
		}
		fmt.Fprintf(out, "%s %s — %s diagnostics (USB %s, protocol %d)\n", result.ID, mark, report.Diagnostic, result.Serial, result.Protocol)
		if result.Error != "" {
			fmt.Fprintln(out, "  "+result.Error)
			continue
		}
		if result.Audio != nil {
			for _, tone := range result.Audio.Tones {
				fmt.Fprintf(out, "  %d Hz: quiet %.2f → tone %.2f RMS (%.2fx, %+.2f)\n", tone.FrequencyHz, tone.BaselineRMS, tone.RMS, tone.Ratio, tone.Rise)
			}
			if !result.Audio.Pass {
				fmt.Fprintln(out, "  Audio FAIL: "+result.Audio.Reason)
			}
		}
		if motion := result.Motion; motion != nil {
			if motion.Pass {
				movement := "stationary; movement was not required"
				if motion.MovementDetected {
					movement = "movement detected"
				}
				fmt.Fprintf(out, "  Motion: %d samples · tilt %+.2f..%+.2f · accel %.2f..%.2f m/s² · %s\n", motion.Samples, motion.MinTilt, motion.MaxTilt, motion.MinAccel, motion.MaxAccel, movement)
			} else {
				fmt.Fprintln(out, "  Motion FAIL: "+motion.Reason)
			}
		}
	}
	overall := "FAIL"
	if report.Pass {
		overall = "PASS"
	}
	fmt.Fprintf(out, "Overall: %s\n", overall)
}
