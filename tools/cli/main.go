// cli is the local bench tool for the XIAO MG24 Sense: it flashes one-off strip tests
// and whole firmware builds to a USB-connected board, and streams what the board says
// back, so bench work doesn't depend on the phone remote. With no arguments it opens the
// TUI in internal/tui, and the subcommands here do the same jobs for scripts.
//
// This file is the command line: Cobra subcommands, and the flow from parsed flags to a
// flash. The pieces it calls own the rest. internal/bench is what a test is, boards is
// which board it runs on, link talks to that board, flash runs PlatformIO, and theme
// decides how output looks. A bench test becomes build flags for the `bench` PlatformIO
// environment (see src/modes/bench.cpp), so running one never edits firmware sources and
// never touches a shoe's saved settings. `./cli app` puts the shoe app back, and `./cli
// web` (internal/webapp) runs the phone remote in a browser here.
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/controlconfig"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
	"firewalker/cli/internal/theme"
	"firewalker/cli/internal/tui"
	"firewalker/cli/internal/webapp"
)

// How long a boot gets to answer `status` before it's treated as not running the app.
// The app answers within a few milliseconds, so this mostly decides how long a bench
// build holds up the next run.
const statusTimeout = 1200 * time.Millisecond

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if err := newCommand().ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "cli:", err)
		os.Exit(1)
	}
}

func newCommand() *cobra.Command { return newCommandWith(runTest) }

// testRunner is what a bench test's subcommand does once its flags are parsed.
type testRunner func(ctx context.Context, cmd *cobra.Command, o *bench.Options, c *bench.Config) error

// newCommandWith builds the command tree around a test runner, so a test can check what
// a command line parses to without flashing anything.
func newCommandWith(run testRunner) *cobra.Command {
	opts := &bench.Options{}
	root := &cobra.Command{
		Use: "cli", Short: "Build and run MG24 Sense strip tests on D10",
		Long:         "Run MG24 bench tests without editing firmware settings. Defaults: the board's saved strip layout, brightness 16/255, data on D10. Each command builds and uploads; --build-only compiles without touching the board.",
		SilenceUsage: true, SilenceErrors: true,
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	f := root.PersistentFlags()
	f.StringVar(&opts.RepoRoot, "repo-root", "../..", "Firewalker repository root")
	_ = f.MarkHidden("repo-root")
	f.IntVar(&opts.Pixels, "pixels", 0, "Total connected pixels (1–4096); pattern tests default to the board's saved layout, then include/config.h")
	f.IntVar(&opts.Brightness, "brightness", 16, "Global brightness (1–255; not a current limit)")
	f.StringVar(&opts.Port, "port", "", "MG24 USB port; auto-detected when one board is connected")
	f.StringVar(&opts.Serial, "serial", "", "MG24 USB serial number; useful with multiple boards")
	f.BoolVar(&opts.BuildOnly, "build-only", false, "Compile without uploading")
	f.BoolVar(&opts.DryRun, "dry-run", false, "Show resolved settings without compiling or uploading")
	f.BoolVar(&opts.Debug, "debug", false, "Stay attached after the upload and stream the board's output; Ctrl-C leaves the board running")

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
			flags.BoolVar(&cfg.LogMotion, "log-motion", false, "Log motion over USB and stream it after flashing; Ctrl-C leaves the board running")
			flags.Float64Var(&cfg.Tilt, "tilt", 0, "Fixed simulated tilt (-1 heel-down, 0 level, +1 toe-down)")
			flags.DurationVar(&cfg.StompEvery, "stomp-every", 0, "Simulate impacts at this interval; 0 disables (fire-trail defaults to 1s without --motion)")
			flags.IntVar(&cfg.Toe, "toe", -1, "Toe pixel; defaults to the board's saved layout, or 32.5% of the strip with a custom --pixels")
			flags.IntVar(&cfg.Heel, "heel", -1, "Heel pixel; defaults to the board's saved layout, or 82.5% of the strip with a custom --pixels")
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
			return run(cmd.Context(), cmd, opts, cfg)
		}
		root.AddCommand(cmd)
	}
	root.AddCommand(newAppCommand(opts))
	root.AddCommand(newWebCommand(opts))

	// Bare `./cli` opens the TUI for a person at a terminal. Piped or scripted, there's
	// nobody to press keys, so it prints help.
	root.RunE = func(cmd *cobra.Command, _ []string) error {
		if !term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stdout.Fd())) {
			return cmd.Help()
		}
		return tui.Run(opts.RepoRoot)
	}
	return root
}

func newAppCommand(opts *bench.Options) *cobra.Command {
	return &cobra.Command{
		Use:   "app",
		Short: "Flash the shoe app (final_app) back onto a board; its saved settings stay",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			// The app's strip and brightness come from each boot's saved settings, so
			// these flags would quietly do nothing.
			if err := refuseFlags(cmd, "app uses the boot's saved settings", "pixels", "brightness"); err != nil {
				return err
			}
			return runApp(cmd.Context(), cmd, opts)
		},
	}
}

// newWebCommand builds `./cli web`, which runs the phone remote in a browser on this
// computer. Its build-only and dry-run flags are the shared ones, which mean the same
// thing here as they do for a bench test.
func newWebCommand(opts *bench.Options) *cobra.Command {
	web := webapp.Options{}
	cmd := &cobra.Command{
		Use:   "web",
		Short: "Build the phone remote and open it in a browser on this computer",
		Long:  "Build the phone remote in app/ and serve it at http://localhost:5173, then open it in your browser. Ctrl-C stops the server. Real boots need Chrome or Arc, because Safari has no Web Bluetooth. --fake opens it with pretend boots, which work anywhere.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			// The boots connect from the browser, so nothing here touches a board. In
			// particular, --port is a USB port, and the web port doesn't change.
			if err := refuseFlags(cmd, "web doesn't touch a board", "pixels", "brightness", "port", "serial", "debug"); err != nil {
				return err
			}
			web.RepoRoot, web.BuildOnly = opts.RepoRoot, opts.BuildOnly
			if err := web.Check(); err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			if opts.DryRun {
				return printWebPlan(out, web)
			}
			return webapp.Run(cmd.Context(), web, theme.New(out), out, os.Stderr)
		},
	}
	cmd.Flags().BoolVar(&web.Dev, "dev", false, "Run the hot-reload dev server instead of building")
	cmd.Flags().BoolVar(&web.Fake, "fake", false, "Open it with pretend boots, for working without hardware")
	cmd.Flags().BoolVar(&web.NoOpen, "no-open", false, "Don't open a browser; just print the address")
	return cmd
}

func printWebPlan(out io.Writer, web webapp.Options) error {
	plan := web.Plan()
	fmt.Fprintf(out, "Would run in %s:\n", plan.Dir)
	for _, step := range plan.Setup {
		fmt.Fprintln(out, "  "+step.String())
	}
	if plan.Serve != nil {
		fmt.Fprintln(out, "  "+plan.Serve.String())
		fmt.Fprintln(out, "Then open "+web.URL())
	}
	return nil
}

// refuseFlags fails if any of the named shared flags were set, so a flag can't quietly
// do nothing on a command it doesn't apply to.
func refuseFlags(cmd *cobra.Command, reason string, names ...string) error {
	for _, name := range names {
		if cmd.Flag(name).Changed {
			return fmt.Errorf("%s, so --%s doesn't apply", reason, name)
		}
	}
	return nil
}

// openCache opens this user's boards.json. If there's no config folder to keep it in,
// reads come back empty and writes fail, so nothing gets remembered and nothing breaks.
func openCache() *boards.Cache {
	path, err := boards.DefaultCachePath()
	if err != nil {
		path = ""
	}
	return boards.OpenCache(path)
}

// resolvedLayout is a layout plus a sentence saying where it came from.
type resolvedLayout struct {
	bench.ResolvedLayout
	Note string
}

// layoutFinder works out which strip layout a pattern test should light. query is a
// field so tests can answer for a boot.
type layoutFinder struct {
	cache *boards.Cache
	query func(ctx context.Context, port string) (*protocol.Status, error)
}

func newLayoutFinder(cache *boards.Cache) layoutFinder {
	return layoutFinder{cache: cache, query: func(ctx context.Context, port string) (*protocol.Status, error) {
		return link.QueryStatus(ctx, port, statusTimeout)
	}}
}

// resolve asks the target board, when there is one, and falls back to what's remembered
// about it and then config.h. serial names a board that can't be asked, for a dry run
// with no single connected target. A boot's answer is written to the cache, because the
// bench build about to replace the app can't answer later.
func (f layoutFinder) resolve(ctx context.Context, config bench.StripLayout, target *boards.Board, serial string) resolvedLayout {
	choices := bench.LayoutChoices{Config: config}
	reason := "no board to ask"
	if target != nil {
		serial = target.Serial
		status, err := f.query(ctx, target.Port)
		switch {
		case err != nil:
			reason = "it didn't answer: " + err.Error()
		default:
			layout, ok := status.Layout()
			if ok {
				saved := bench.StripLayout{Pixels: layout.LEDs, Toe: layout.Toe, Heel: layout.Heel}
				choices.Boot = &saved
			} else {
				reason = fmt.Sprintf("%s is on proto %d, which doesn't report one", status.ID, status.Proto)
			}
			f.remember(serial, status)
		}
	}
	id := serial
	if record, ok := f.cache.Get(serial); ok && serial != "" {
		if record.ID != "" {
			id = record.ID
		}
		if choices.Boot == nil && record.Layout != nil {
			choices.Remembered = &bench.StripLayout{Pixels: record.Layout.LEDs, Toe: record.Layout.Toe, Heel: record.Layout.Heel}
		}
	}

	picked := bench.PickLayout(choices)
	note := "include/config.h (" + reason + ")"
	switch picked.Source {
	case bench.SourceBoot:
		note = "saved on " + id + " (read just now)"
	case bench.SourceRemembered:
		note = id + "'s last known layout (" + reason + ")"
	}
	return resolvedLayout{ResolvedLayout: picked, Note: note}
}

func (f layoutFinder) remember(serial string, status *protocol.Status) {
	_ = f.cache.Update(serial, func(r *boards.Record) {
		if status.ID != "" {
			r.ID = status.ID
		}
		if layout, ok := status.Layout(); ok {
			r.Layout = &boards.SavedLayout{LEDs: layout.LEDs, Toe: layout.Toe, Heel: layout.Heel}
		}
	})
}

// findTarget picks the board named by --port or --serial, or the only one connected.
func findTarget(o *bench.Options) (boards.Board, error) {
	connected, err := boards.Discover()
	if err != nil {
		return boards.Board{}, err
	}
	return boards.Select(connected, o.Port, o.Serial)
}

// runTest takes a parsed bench test through to a flash. Bad flags fail before anything
// touches a board. Then comes the layout, which may need the board's answer, and only
// then the checks that depend on the strip's length.
func runTest(ctx context.Context, cmd *cobra.Command, o *bench.Options, c *bench.Config) error {
	out := cmd.OutOrStdout()
	th := theme.New(out)
	if err := bench.CheckInputs(o, c); err != nil {
		return err
	}

	upload := !o.BuildOnly && !o.DryRun
	pixelsGiven := cmd.Flag("pixels").Changed
	wantsSavedLayout := c.IsPattern() && !pixelsGiven

	// An upload needs exactly one board, so anything else stops here. A dry run or a
	// build-only run is fine without one: it just can't ask for the saved layout.
	var target *boards.Board
	if upload || wantsSavedLayout {
		found, err := findTarget(o)
		if upload && err != nil {
			return err
		}
		if err == nil {
			target = &found
		}
	}

	cache := openCache()
	layoutNote := layoutFlagsNote(cmd, c)
	if !pixelsGiven {
		config, err := bench.ReadStripLayout(o.RepoRoot)
		if err != nil {
			return err
		}
		if wantsSavedLayout {
			resolved := newLayoutFinder(cache).resolve(ctx, config, target, o.Serial)
			bench.ApplyLayout(o, c, resolved.Layout)
			layoutNote = resolved.Note + withOverrides(cmd, c)
		} else {
			// Color and off tests don't use a ring. They light the whole configured
			// length, and pixels a cut strip doesn't have simply never receive it.
			bench.ApplyLayout(o, c, config)
		}
	}
	if err := bench.Validate(o, c); err != nil {
		return err
	}

	fmt.Fprintln(out, th.Bold.Render(fmt.Sprintf("Test: %s | pixels: %d | brightness: %d/255 | D10 | motion: %t", c.Name, o.Pixels, o.Brightness, c.Motion)))
	if c.IsPattern() {
		fmt.Fprintf(out, "Layout: toe=%d heel=%d | simulated tilt: %.2f | timed impacts: %s\n", c.Toe, c.Heel, c.Tilt, c.StompEvery)
		fmt.Fprintln(out, th.Dim.Render("Layout from: "+layoutNote))
	}
	job := flash.Job{RepoRoot: o.RepoRoot, Env: "bench", SrcFlags: bench.BuildFlags(o, c)}
	return flashAndFollow(ctx, out, th, cache, o, job, target, "bench "+c.Name, o.Debug || c.LogMotion)
}

// layoutFlagsNote says where a layout came from when --pixels set it directly. A color
// or off test has no ring, and this note never gets printed for it.
func layoutFlagsNote(cmd *cobra.Command, c *bench.Config) string {
	if !c.IsPattern() {
		return ""
	}
	if cmd.Flags().Changed("toe") && cmd.Flags().Changed("heel") {
		return "--pixels, --toe, and --heel"
	}
	return "--pixels (toe and heel scaled to fit, unless set)"
}

// withOverrides adds which marker flags replaced part of a saved layout.
func withOverrides(cmd *cobra.Command, c *bench.Config) string {
	if !c.IsPattern() {
		return ""
	}
	var flags []string
	for _, name := range []string{"toe", "heel"} {
		if cmd.Flags().Changed(name) {
			flags = append(flags, "--"+name)
		}
	}
	if len(flags) == 0 {
		return ""
	}
	return ", with " + strings.Join(flags, " and ")
}

// runApp flashes the shoe app, which is the usual way back after bench work.
func runApp(ctx context.Context, cmd *cobra.Command, o *bench.Options) error {
	out := cmd.OutOrStdout()
	th := theme.New(out)
	if err := o.CheckTarget(); err != nil {
		return err
	}
	var target *boards.Board
	if !o.BuildOnly && !o.DryRun {
		found, err := findTarget(o)
		if err != nil {
			return err
		}
		target = &found
	}
	fmt.Fprintln(out, th.Bold.Render("App: final_app | saved settings stay"))
	job := flash.Job{RepoRoot: o.RepoRoot, Env: flash.AppEnv}
	return flashAndFollow(ctx, out, th, openCache(), o, job, target, flash.AppEnv, o.Debug)
}

// flashAndFollow finishes every flash the same way: stop at a dry run, name the target,
// run PlatformIO, note what's on the board now, and optionally stay attached.
func flashAndFollow(ctx context.Context, out io.Writer, th *theme.Theme, cache *boards.Cache, o *bench.Options, job flash.Job, target *boards.Board, label string, follow bool) error {
	var idleTimeout time.Duration
	if follow && !o.BuildOnly && !o.DryRun {
		var err error
		idleTimeout, err = controlconfig.Read(o.RepoRoot)
		if err != nil {
			return err
		}
	}
	if o.DryRun {
		fmt.Fprintln(out, "Dry run: no compilation, upload, or firmware-source changes.")
		return nil
	}
	if !o.BuildOnly {
		fmt.Fprintf(out, "Target: %s (serial %s)\n", target.Port, target.Serial)
		job.Serial = target.Serial
	}
	if err := job.Run(ctx, os.Environ(), os.Stdout, os.Stderr); err != nil {
		return err
	}
	if o.BuildOnly {
		return nil
	}
	if err := cache.Update(target.Serial, func(r *boards.Record) {
		r.LastFlashed = label
		r.FlashedAt = time.Now()
	}); err != nil {
		fmt.Fprintln(out, th.Dim.Render("Couldn't remember what's on this board: "+err.Error()))
	}
	if follow {
		streamBoard(ctx, out, th, target.Serial, idleTimeout)
	}
	return nil
}
