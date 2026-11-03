// mg24 is a temporary, local bench-test launcher. Cobra handles arguments;
// runTest builds an isolated Arduino sketch using the repo's real patterns,
// MG24 motion adapter, and timed strip driver. Flags become a generated header
// and compiler definitions, so running a test never rewrites firmware sources.
package main

import (
	"context"
	_ "embed"
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

//go:embed firmware/bench.ino
var firmware []byte

const fqbn = "SiliconLabs:silabs:xiao_mg24:protocol_stack=none"

type options struct {
	protoDir, port, serial string
	pixels, brightness     int
	buildOnly, dryRun      bool
}

type testConfig struct {
	name              string
	mode, toe, heel   int
	motion, logMotion bool
	tilt              float64
	stompEvery        time.Duration
	lit               int
	color             string
	interval          time.Duration
	colorCycle        bool
	colorRGB          uint32
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if err := newCommand().ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "mg24:", err)
		os.Exit(1)
	}
}

func newCommand() *cobra.Command {
	opts := &options{}
	root := &cobra.Command{
		Use: "mg24", Short: "Build and run MG24 Sense strip tests on D10",
		Long:         "Run MG24 bench tests without editing firmware settings. Defaults: 160 pixels, brightness 16/255, data on D10. Each command builds and uploads; --build-only compiles without touching the board.",
		SilenceUsage: true, SilenceErrors: true,
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	f := root.PersistentFlags()
	f.StringVar(&opts.protoDir, "proto-dir", "..", "MG24 prototype directory")
	_ = f.MarkHidden("proto-dir")
	f.IntVar(&opts.pixels, "pixels", 160, "Total connected pixels (1–4096)")
	f.IntVar(&opts.brightness, "brightness", 16, "Global brightness (0–255; not a current limit)")
	f.StringVar(&opts.port, "port", "", "MG24 USB port; auto-detected when one board is connected")
	f.StringVar(&opts.serial, "serial", "", "USB debug-probe serial; useful with multiple MG24 boards")
	f.BoolVar(&opts.buildOnly, "build-only", false, "Compile without uploading")
	f.BoolVar(&opts.dryRun, "dry-run", false, "Show resolved settings without compiling or uploading")

	for mode, name := range []string{"flow", "fire-trail", "color", "off", "probe"} {
		cfg := &testConfig{name: name, mode: mode, toe: -1, heel: -1, lit: -1, color: "cycle", interval: 500 * time.Millisecond}
		short := map[string]string{
			"flow":       "Run spectrum-cycling flow (no motion by default)",
			"fire-trail": "Launch fire trails on a timer, or from motion",
			"color":      "Cycle white/red/green/blue, or show a fixed color",
			"off":        "Blank every connected pixel (power remains on)",
			"probe":      "Hold D10 HIGH for a 3.3V multimeter continuity check",
		}[name]
		cmd := &cobra.Command{Use: name, Short: short, Args: cobra.NoArgs}
		if mode <= 1 {
			flags := cmd.Flags()
			flags.BoolVar(&cfg.motion, "motion", false, "Use the onboard sensor for tilt and stomp input")
			flags.BoolVar(&cfg.logMotion, "log-motion", false, "Log motion to UART D12 TX; requires a UART adapter")
			flags.Float64Var(&cfg.tilt, "tilt", 0, "Fixed simulated tilt (-1 heel-down, 0 level, +1 toe-down)")
			flags.DurationVar(&cfg.stompEvery, "stomp-every", 0, "Simulate impacts at this interval; 0 disables (fire-trail defaults to 1s without --motion)")
			flags.IntVar(&cfg.toe, "toe", -1, "Virtual toe pixel; defaults to 32.5% of the strip")
			flags.IntVar(&cfg.heel, "heel", -1, "Virtual heel pixel; defaults to 82.5% of the strip")
		}
		if name == "color" {
			cmd.Flags().IntVar(&cfg.lit, "lit", -1, "Pixels to light at the input end; defaults to all")
			cmd.Flags().StringVar(&cfg.color, "color", "cycle", "cycle, white, red, green, blue, or '#RRGGBB'")
			cmd.Flags().DurationVar(&cfg.interval, "interval", 500*time.Millisecond, "Time per color in the cycle")
		}
		cmd.RunE = func(cmd *cobra.Command, _ []string) error {
			if cfg.name == "fire-trail" && !cfg.motion && !cmd.Flags().Changed("stomp-every") {
				cfg.stompEvery = time.Second
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

// Validate before discovering hardware or starting any build. Ring coordinates
// must describe two nonempty arcs; simple color/off/probe tests also allow one
// pixel. Motion and simulated inputs are exclusive so flags cannot be ignored.
func validate(o *options, c *testConfig) error {
	if o.pixels < 1 || o.pixels > 4096 {
		return fmt.Errorf("--pixels must be between 1 and 4096")
	}
	if o.brightness < 0 || o.brightness > 255 {
		return fmt.Errorf("--brightness must be between 0 and 255")
	}
	if c.mode <= 1 {
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
			return fmt.Errorf("--log-motion requires --motion (logs use UART, not USB)")
		}
		if c.name == "fire-trail" && c.tilt != 0 {
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

// stageSketch copies the selected test's collaborators into a throwaway sketch.
// The original app, diagnostic sketches, and their saved settings are untouched.
func stageSketch(tempDir, protoDir string, o *options, c *testConfig) (string, error) {
	sketch := filepath.Join(tempDir, "bench")
	if err := os.MkdirAll(filepath.Join(sketch, "src"), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(sketch, "bench.ino"), firmware, 0o644); err != nil {
		return "", err
	}
	settings := fmt.Sprintf(`#pragma once
#define BENCH_MODE %d
#define BENCH_PIXELS %d
#define BENCH_LIT_PIXELS %d
#define BENCH_BRIGHTNESS %d
#define BENCH_MOTION %d
#define BENCH_LOG_MOTION %d
#define BENCH_TILT %s
#define BENCH_STOMP_MS %dUL
#define BENCH_INTERVAL_MS %dUL
#define BENCH_COLOR_CYCLE %d
#define BENCH_COLOR_RGB 0x%06XUL
`, c.mode, o.pixels, c.lit, o.brightness, bit(c.motion), bit(c.logMotion), strconv.FormatFloat(c.tilt, 'f', 6, 64), c.stompEvery.Milliseconds(), c.interval.Milliseconds(), bit(c.colorCycle), c.colorRGB)
	if err := os.WriteFile(filepath.Join(sketch, "bench_settings.h"), []byte(settings), 0o644); err != nil {
		return "", err
	}
	files := map[string]string{filepath.Join(protoDir, "Adafruit_NeoPixel.h"): filepath.Join(sketch, "Adafruit_NeoPixel.h")}
	repo := filepath.Clean(filepath.Join(protoDir, "..", ".."))
	if c.mode <= 1 {
		pattern := "flow.cpp"
		if c.mode == 1 {
			pattern = "fire_trail.cpp"
		}
		files[filepath.Join(repo, "src", "patterns", pattern)] = filepath.Join(sketch, "src", "pattern.cpp")
	}
	if c.motion {
		files[filepath.Join(protoDir, "src", "imu_xiao.cpp")] = filepath.Join(sketch, "src", "motion.cpp")
	}
	for from, to := range files {
		data, err := os.ReadFile(from)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(to, data, 0o644); err != nil {
			return "", err
		}
	}
	return sketch, nil
}

func bit(value bool) int {
	if value {
		return 1
	}
	return 0
}

func runTest(ctx context.Context, cmd *cobra.Command, o *options, c *testConfig) error {
	fmt.Fprintf(cmd.OutOrStdout(), "Test: %s | pixels: %d | brightness: %d/255 | D10 | motion: %t\n", c.name, o.pixels, o.brightness, c.motion)
	if c.mode <= 1 {
		fmt.Fprintf(cmd.OutOrStdout(), "Layout: toe=%d heel=%d | simulated tilt: %.2f | timed impacts: %s\n", c.toe, c.heel, c.tilt, c.stompEvery)
	}
	if o.dryRun {
		fmt.Fprintln(cmd.OutOrStdout(), "Dry run: no compilation, upload, or firmware-source changes.")
		return nil
	}
	if _, err := exec.LookPath("arduino-cli"); err != nil {
		return fmt.Errorf("arduino-cli is required for the existing MG24 build path: %w", err)
	}
	protoDir, err := filepath.Abs(o.protoDir)
	if err != nil {
		return err
	}
	var board board
	if !o.buildOnly {
		board, err = selectBoard(ctx, o)
		if err != nil {
			return err
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Target: %s (probe %s)\n", board.Port.Address, board.Port.Properties.Serial)
	}
	temp, err := os.MkdirTemp("", "firewalker-mg24-test-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	sketch, err := stageSketch(temp, protoDir, o, c)
	if err != nil {
		return err
	}
	repo := filepath.Clean(filepath.Join(protoDir, "..", ".."))
	// These include flags are passed through Arduino CLI as one build property,
	// without a shell. Its dependency scanner expects unquoted include paths.
	flags := []string{"-I" + sketch, "-I" + filepath.Join(repo, "include"), "-I" + filepath.Join(repo, "src"), "-DFIREWALKER_ADAFRUIT_STRIP_API"}
	if c.mode <= 1 {
		flags = append(flags, fmt.Sprintf("-DFIREWALKER_LED_COUNT=%d", o.pixels), fmt.Sprintf("-DFIREWALKER_LED_BRIGHTNESS=%d", o.brightness), fmt.Sprintf("-DFIREWALKER_STRIP_TOE_INDEX=%d", c.toe), fmt.Sprintf("-DFIREWALKER_STRIP_HEEL_INDEX=%d", c.heel))
	}
	buildDir := filepath.Join(temp, "build")
	if err := run(ctx, "compile", "--fqbn", fqbn, "--output-dir", buildDir, "--build-property", "compiler.cpp.extra_flags="+strings.Join(flags, " "), sketch); err != nil {
		return err
	}
	if o.buildOnly {
		return nil
	}
	// The core's default uploader uses the first CMSIS-DAP probe, ignoring the
	// serial-port choice. Select the discovered probe explicitly and verify flash
	// before resetting, so --port/--serial cannot program a different connected shoe.
	serial := board.Port.Properties.Serial
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(serial) {
		return fmt.Errorf("cannot safely select probe serial %q", serial)
	}
	uploadRecipe := `"{cmd}" {upload.verbose} -s "{path}/share/openocd/scripts/" -f interface/cmsis-dap.cfg -f target/efm32s2_g23.cfg -c "adapter serial ` + serial + `; init; reset_config srst_nogate; reset halt; program {{build.path}/{build.project_name}.hex} verify; reset; exit"`
	// Arduino CLI has already flattened tools.openocd.* when it applies upload
	// overrides, so the effective key here is upload.pattern.
	return run(ctx, "upload", "--fqbn", fqbn, "--port", board.Port.Address, "--input-dir", buildDir, "--upload-property", "upload.pattern="+uploadRecipe, sketch)
}

// board mirrors only the Arduino discovery fields needed for device selection.
// Discovery is read-only; multiple boards require an explicit port or serial.
type board struct {
	Port struct {
		Address    string `json:"address"`
		Properties struct {
			Serial string `json:"serialNumber"`
		} `json:"properties"`
	} `json:"port"`
	MatchingBoards []struct {
		FQBN string `json:"fqbn"`
	} `json:"matching_boards"`
}

func selectBoard(ctx context.Context, o *options) (board, error) {
	out, err := exec.CommandContext(ctx, "arduino-cli", "board", "list", "--format", "json").Output()
	if err != nil {
		return board{}, fmt.Errorf("discover MG24 boards: %w", err)
	}
	var result struct {
		Ports []board `json:"detected_ports"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		return board{}, fmt.Errorf("read board discovery: %w", err)
	}
	var matches []board
	for _, b := range result.Ports {
		isMG24 := false
		for _, match := range b.MatchingBoards {
			isMG24 = isMG24 || strings.HasPrefix(match.FQBN, "SiliconLabs:silabs:xiao_mg24")
		}
		if isMG24 && (o.port == "" || o.port == b.Port.Address) && (o.serial == "" || o.serial == b.Port.Properties.Serial) {
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

func run(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, "arduino-cli", args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("arduino-cli %s failed: %w", args[0], err)
	}
	return nil
}
