// cli is the local bench tool for the XIAO MG24 Sense: it builds a one-off strip
// test and flashes it to a USB-connected board, so bench work doesn't depend on the
// phone remote. Cobra handles arguments. Flags become build flags for the `bench`
// PlatformIO environment (see src/modes/bench.cpp), so running a test never edits
// firmware sources and never touches a shoe's saved settings. To return a board to
// the app afterward, run `pio run -e final_app -t upload`.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// The XIAO MG24's onboard debug probe, which is also its USB serial port.
const (
	usbID      = "2886:0062"
	serialBaud = "115200"
)

type options struct {
	repoRoot, port, serial string
	pixels, brightness     int
	buildOnly, dryRun      bool
}

// The values match BENCH_TEST in src/modes/bench.cpp.
const (
	testFlow = iota
	testFireTrail
	testColor
	testOff
)

type testConfig struct {
	name              string
	test, toe, heel   int
	motion, logMotion bool
	tilt              float64
	stompEvery        time.Duration
	lit               int
	color             string
	interval          time.Duration
	colorCycle        bool
	colorRGB          uint32
}

func (c *testConfig) isPattern() bool { return c.test == testFlow || c.test == testFireTrail }

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if err := newCommand().ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "cli:", err)
		os.Exit(1)
	}
}

func newCommand() *cobra.Command {
	opts := &options{}
	root := &cobra.Command{
		Use: "cli", Short: "Build and run MG24 Sense strip tests on D10",
		Long:         "Run MG24 bench tests without editing firmware settings. Defaults: the strip length in include/config.h, brightness 16/255, data on D10. Each command builds and uploads; --build-only compiles without touching the board.",
		SilenceUsage: true, SilenceErrors: true,
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	f := root.PersistentFlags()
	f.StringVar(&opts.repoRoot, "repo-root", "../..", "Firewalker repository root")
	_ = f.MarkHidden("repo-root")
	f.IntVar(&opts.pixels, "pixels", 0, "Total connected pixels (1–4096); defaults to FIREWALKER_LED_COUNT in include/config.h")
	f.IntVar(&opts.brightness, "brightness", 16, "Global brightness (1–255; not a current limit)")
	f.StringVar(&opts.port, "port", "", "MG24 USB port; auto-detected when one board is connected")
	f.StringVar(&opts.serial, "serial", "", "MG24 USB serial number; useful with multiple boards")
	f.BoolVar(&opts.buildOnly, "build-only", false, "Compile without uploading")
	f.BoolVar(&opts.dryRun, "dry-run", false, "Show resolved settings without compiling or uploading")

	tests := []struct {
		name, short string
		test        int
	}{
		{"flow", "Run spectrum-cycling flow (no motion by default)", testFlow},
		{"fire-trail", "Launch fire trails on a timer, or from motion", testFireTrail},
		{"color", "Cycle white/red/green/blue, or show a fixed color", testColor},
		{"off", "Blank every connected pixel (power remains on)", testOff},
	}
	for _, t := range tests {
		cfg := &testConfig{name: t.name, test: t.test, toe: -1, heel: -1, lit: -1, color: "cycle", interval: 500 * time.Millisecond}
		cmd := &cobra.Command{Use: t.name, Short: t.short, Args: cobra.NoArgs}
		if cfg.isPattern() {
			flags := cmd.Flags()
			flags.BoolVar(&cfg.motion, "motion", false, "Use the onboard sensor for tilt and stomp input")
			flags.BoolVar(&cfg.logMotion, "log-motion", false, "Stream motion logs over USB after flashing; Ctrl-C leaves the board running")
			flags.Float64Var(&cfg.tilt, "tilt", 0, "Fixed simulated tilt (-1 heel-down, 0 level, +1 toe-down)")
			flags.DurationVar(&cfg.stompEvery, "stomp-every", 0, "Simulate impacts at this interval; 0 disables (fire-trail defaults to 1s without --motion)")
			flags.IntVar(&cfg.toe, "toe", -1, "Toe pixel; defaults to config.h, or 32.5% of the strip with a custom --pixels")
			flags.IntVar(&cfg.heel, "heel", -1, "Heel pixel; defaults to config.h, or 82.5% of the strip with a custom --pixels")
		}
		if t.test == testColor {
			cmd.Flags().IntVar(&cfg.lit, "lit", -1, "Pixels to light at the input end; defaults to all")
			cmd.Flags().StringVar(&cfg.color, "color", "cycle", "cycle, white, red, green, blue, or '#RRGGBB'")
			cmd.Flags().DurationVar(&cfg.interval, "interval", 500*time.Millisecond, "Time per color in the cycle")
		}
		cmd.RunE = func(cmd *cobra.Command, _ []string) error {
			if cfg.test == testFireTrail && !cfg.motion && !cmd.Flags().Changed("stomp-every") {
				cfg.stompEvery = time.Second
			}
			// A custom strip length gets its layout scaled in validate, because the
			// configured toe and heel only describe the configured length.
			if !cmd.Flag("pixels").Changed {
				layout, err := readStripLayout(opts.repoRoot)
				if err != nil {
					return err
				}
				opts.pixels = layout.pixels
				if cfg.toe == -1 {
					cfg.toe = layout.toe
				}
				if cfg.heel == -1 {
					cfg.heel = layout.heel
				}
			}
			if err := validate(opts, cfg); err != nil {
				return err
			}
			return runTest(cmd.Context(), cmd, opts, cfg)
		}
		root.AddCommand(cmd)
	}
	return root
}

type stripLayout struct{ pixels, toe, heel int }

// parseStripLayout pulls the strip's default size and ring positions out of config.h's
// source, so this tool and the firmware have one place to change them.
func parseStripLayout(config string) (stripLayout, error) {
	read := func(name string) (int, error) {
		match := regexp.MustCompile(`(?m)^#define ` + name + ` (\d+)\s*$`).FindStringSubmatch(config)
		if match == nil {
			return 0, fmt.Errorf("can't find %s in include/config.h", name)
		}
		return strconv.Atoi(match[1])
	}
	var layout stripLayout
	var err error
	if layout.pixels, err = read("FIREWALKER_LED_COUNT"); err != nil {
		return layout, err
	}
	if layout.toe, err = read("FIREWALKER_STRIP_TOE_INDEX"); err != nil {
		return layout, err
	}
	layout.heel, err = read("FIREWALKER_STRIP_HEEL_INDEX")
	return layout, err
}

func readStripLayout(repoRoot string) (stripLayout, error) {
	data, err := os.ReadFile(filepath.Join(repoRoot, "include", "config.h"))
	if err != nil {
		return stripLayout{}, err
	}
	return parseStripLayout(string(data))
}

// Validate before discovering hardware or starting any build. Ring coordinates
// must describe two nonempty arcs; simple color/off tests also allow one pixel.
// Motion and simulated inputs are exclusive so flags cannot be ignored.
func validate(o *options, c *testConfig) error {
	if o.pixels < 1 || o.pixels > 4096 {
		return fmt.Errorf("--pixels must be between 1 and 4096")
	}
	if o.brightness < 1 || o.brightness > 255 {
		return fmt.Errorf("--brightness must be between 1 and 255")
	}
	if o.port != "" && o.serial != "" {
		return fmt.Errorf("use --port or --serial, not both")
	}
	if c.isPattern() {
		if o.pixels < 2 {
			return fmt.Errorf("patterns need at least 2 pixels")
		}
		if c.toe == -1 {
			c.toe = o.pixels * 13 / 40
		}
		if c.heel == -1 {
			c.heel = o.pixels * 33 / 40
		}
		if c.toe < 0 || c.toe >= c.heel || c.heel >= o.pixels {
			return fmt.Errorf("layout must satisfy 0 <= toe < heel < pixels")
		}
		if math.IsNaN(c.tilt) || math.IsInf(c.tilt, 0) || c.tilt < -1 || c.tilt > 1 {
			return fmt.Errorf("--tilt must be between -1 and 1")
		}
		if c.stompEvery < 0 || c.stompEvery > time.Hour || c.stompEvery > 0 && c.stompEvery < time.Millisecond {
			return fmt.Errorf("--stomp-every must be 0 or between 1ms and 1h")
		}
		if c.motion && (c.tilt != 0 || c.stompEvery != 0) {
			return fmt.Errorf("--motion cannot be combined with simulated --tilt or --stomp-every")
		}
		if c.logMotion && !c.motion {
			return fmt.Errorf("--log-motion requires --motion")
		}
		if c.logMotion && o.buildOnly {
			return fmt.Errorf("--log-motion needs an upload, so it can't be combined with --build-only")
		}
		if c.test == testFireTrail && c.tilt != 0 {
			return fmt.Errorf("fire-trail does not use tilt; use flow --tilt instead")
		}
	}
	if c.lit == -1 {
		c.lit = o.pixels
	}
	if c.lit < 0 || c.lit > o.pixels {
		return fmt.Errorf("--lit must be between 0 and --pixels")
	}
	if c.interval < time.Millisecond || c.interval > time.Hour {
		return fmt.Errorf("--interval must be between 1ms and 1h")
	}
	palette := map[string]uint32{"white": 0xFFFFFF, "red": 0xFF0000, "green": 0x00FF00, "blue": 0x0000FF}
	color := strings.ToLower(c.color)
	if color == "cycle" {
		c.colorCycle = true
	} else if rgb, ok := palette[color]; ok {
		c.colorRGB = rgb
	} else if len(color) == 7 && color[0] == '#' {
		rgb, err := strconv.ParseUint(color[1:], 16, 24)
		if err != nil {
			return fmt.Errorf("invalid --color: use '#RRGGBB'")
		}
		c.colorRGB = uint32(rgb)
	} else {
		return fmt.Errorf("invalid --color: use cycle, white, red, green, blue, or '#RRGGBB'")
	}
	return nil
}

// buildFlags turns a validated test into the macros src/modes/bench.cpp reads.
// config.h requires a valid ring layout even for tests that don't use one, so color
// and off tests get a placeholder. A ring needs two pixels, so a one-pixel test sends
// one extra black pixel, which a one-pixel strip simply never receives.
func buildFlags(o *options, c *testConfig) []string {
	pixels, toe, heel := o.pixels, c.toe, c.heel
	if !c.isPattern() {
		if pixels < 2 {
			pixels = 2
		}
		toe, heel = 0, pixels-1
	}
	return []string{
		fmt.Sprintf("-DBENCH_TEST=%d", c.test),
		fmt.Sprintf("-DFIREWALKER_LED_COUNT=%d", pixels),
		fmt.Sprintf("-DFIREWALKER_LED_BRIGHTNESS=%d", o.brightness),
		fmt.Sprintf("-DFIREWALKER_STRIP_TOE_INDEX=%d", toe),
		fmt.Sprintf("-DFIREWALKER_STRIP_HEEL_INDEX=%d", heel),
		fmt.Sprintf("-DBENCH_LIT_PIXELS=%d", c.lit),
		fmt.Sprintf("-DBENCH_MOTION=%d", bit(c.motion)),
		fmt.Sprintf("-DBENCH_LOG_MOTION=%d", bit(c.logMotion)),
		fmt.Sprintf("-DBENCH_TILT=%sf", strconv.FormatFloat(c.tilt, 'f', 6, 64)),
		fmt.Sprintf("-DBENCH_STOMP_MS=%dUL", c.stompEvery.Milliseconds()),
		fmt.Sprintf("-DBENCH_INTERVAL_MS=%dUL", c.interval.Milliseconds()),
		fmt.Sprintf("-DBENCH_COLOR_CYCLE=%d", bit(c.colorCycle)),
		fmt.Sprintf("-DBENCH_COLOR_RGB=0x%06XUL", c.colorRGB),
	}
}

func bit(value bool) int {
	if value {
		return 1
	}
	return 0
}

func runTest(ctx context.Context, cmd *cobra.Command, o *options, c *testConfig) error {
	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "Test: %s | pixels: %d | brightness: %d/255 | D10 | motion: %t\n", c.name, o.pixels, o.brightness, c.motion)
	if c.isPattern() {
		fmt.Fprintf(out, "Layout: toe=%d heel=%d | simulated tilt: %.2f | timed impacts: %s\n", c.toe, c.heel, c.tilt, c.stompEvery)
	}
	if o.dryRun {
		fmt.Fprintln(out, "Dry run: no compilation, upload, or firmware-source changes.")
		return nil
	}
	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("PlatformIO's pio command is required: %w", err)
	}

	args := []string{"run", "--project-dir", o.repoRoot, "-e", "bench"}
	var target board
	if !o.buildOnly {
		boards, err := discoverBoards(ctx)
		if err != nil {
			return err
		}
		target, err = selectBoard(boards, o.port, o.serial)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Target: %s (serial %s)\n", target.Port, target.Serial)
		args = append(args, "-t", "upload", "--upload-port", target.Serial)
	}

	// These apply only to the firmware's own sources, so switching tests recompiles
	// them without rebuilding the whole Silicon Labs core.
	build := exec.CommandContext(ctx, "pio", args...)
	build.Env = append(os.Environ(), "PLATFORMIO_BUILD_SRC_FLAGS="+strings.Join(buildFlags(o, c), " "))
	build.Stdout, build.Stderr = os.Stdout, os.Stderr
	if err := build.Run(); err != nil {
		return fmt.Errorf("pio run failed: %w", err)
	}

	if c.logMotion {
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

// board is one connected MG24, identified by its USB serial number. The serial is
// stable for a given board, while the port name can change between connections.
type board struct {
	Port   string
	Serial string
}

var serialPattern = regexp.MustCompile(`SER=([A-Za-z0-9_-]+)`)

// parseBoards reads `pio device list --json-output`, keeping only MG24 boards.
func parseBoards(data []byte) ([]board, error) {
	var ports []struct {
		Port string `json:"port"`
		HWID string `json:"hwid"`
	}
	if err := json.Unmarshal(data, &ports); err != nil {
		return nil, fmt.Errorf("read board discovery: %w", err)
	}
	var boards []board
	for _, p := range ports {
		if !strings.Contains(strings.ToLower(p.HWID), usbID) {
			continue
		}
		match := serialPattern.FindStringSubmatch(p.HWID)
		if match == nil {
			continue
		}
		boards = append(boards, board{Port: p.Port, Serial: match[1]})
	}
	return boards, nil
}

func discoverBoards(ctx context.Context) ([]board, error) {
	data, err := exec.CommandContext(ctx, "pio", "device", "list", "--serial", "--json-output").Output()
	if err != nil {
		return nil, fmt.Errorf("discover MG24 boards: %w", err)
	}
	return parseBoards(data)
}

// selectBoard picks the one board a test may flash. It never guesses: with several
// boards connected and no selection, or a selection matching nothing, it fails
// rather than risk programming a different shoe.
func selectBoard(boards []board, port, serial string) (board, error) {
	var matches []board
	for _, b := range boards {
		if (port == "" || port == b.Port) && (serial == "" || serial == b.Serial) {
			matches = append(matches, b)
		}
	}
	if len(matches) == 0 {
		return board{}, fmt.Errorf("no matching MG24 found; connect it over USB or check --port/--serial")
	}
	if len(matches) > 1 {
		return board{}, fmt.Errorf("found %d MG24 boards; select one with --port or --serial", len(matches))
	}
	return matches[0], nil
}
