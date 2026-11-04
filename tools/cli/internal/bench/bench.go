// Package bench describes one strip test: which test, on how many pixels, with what
// input. It turns that description into the build flags src/modes/bench.cpp reads, so
// running a test never edits firmware sources or touches a boot's saved settings.
//
// It's pure logic with no ports or child processes. The Cobra subcommands in main.go
// fill in an Options and a Config from flags, then Validate and BuildFlags do the rest.
package bench

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Options holds the settings every test shares.
type Options struct {
	RepoRoot, Port, Serial string
	Pixels, Brightness     int
	BuildOnly, DryRun      bool
}

// The values match BENCH_TEST in src/modes/bench.cpp.
const (
	TestFlow = iota
	TestFireTrail
	TestColor
	TestOff
)

// Config describes one test. Toe, Heel, and Lit use -1 for "work it out", which
// Validate fills in. ColorCycle and ColorRGB are also Validate's output, parsed from
// Color.
type Config struct {
	Name              string
	Test, Toe, Heel   int
	Motion, LogMotion bool
	Tilt              float64
	StompEvery        time.Duration
	Lit               int
	Color             string
	Interval          time.Duration
	ColorCycle        bool
	ColorRGB          uint32
}

// IsPattern says whether this test runs a real pattern on the ring, which is what makes
// the toe and heel matter.
func (c *Config) IsPattern() bool { return c.Test == TestFlow || c.Test == TestFireTrail }

// StripLayout is the strip's size and ring positions.
type StripLayout struct{ Pixels, Toe, Heel int }

// ParseStripLayout pulls the strip's default size and ring positions out of config.h's
// source, so this tool and the firmware have one place to change them.
func ParseStripLayout(config string) (StripLayout, error) {
	read := func(name string) (int, error) {
		match := regexp.MustCompile(`(?m)^#define ` + name + ` (\d+)\s*$`).FindStringSubmatch(config)
		if match == nil {
			return 0, fmt.Errorf("can't find %s in include/config.h", name)
		}
		return strconv.Atoi(match[1])
	}
	var layout StripLayout
	var err error
	if layout.Pixels, err = read("FIREWALKER_LED_COUNT"); err != nil {
		return layout, err
	}
	if layout.Toe, err = read("FIREWALKER_STRIP_TOE_INDEX"); err != nil {
		return layout, err
	}
	layout.Heel, err = read("FIREWALKER_STRIP_HEEL_INDEX")
	return layout, err
}

// ReadStripLayout reads config.h from a repo checkout and parses its strip layout.
func ReadStripLayout(repoRoot string) (StripLayout, error) {
	data, err := os.ReadFile(filepath.Join(repoRoot, "include", "config.h"))
	if err != nil {
		return StripLayout{}, err
	}
	return ParseStripLayout(string(data))
}

// Validate checks a test and fills in its derived values. Call it before discovering
// hardware or starting any build. Ring coordinates must describe two nonempty arcs;
// simple color/off tests also allow one pixel. Motion and simulated inputs are exclusive
// so flags cannot be ignored.
func Validate(o *Options, c *Config) error {
	if o.Pixels < 1 || o.Pixels > 4096 {
		return fmt.Errorf("--pixels must be between 1 and 4096")
	}
	if o.Brightness < 1 || o.Brightness > 255 {
		return fmt.Errorf("--brightness must be between 1 and 255")
	}
	if o.Port != "" && o.Serial != "" {
		return fmt.Errorf("use --port or --serial, not both")
	}
	if c.IsPattern() {
		if o.Pixels < 2 {
			return fmt.Errorf("patterns need at least 2 pixels")
		}
		if c.Toe == -1 {
			c.Toe = o.Pixels * 13 / 40
		}
		if c.Heel == -1 {
			c.Heel = o.Pixels * 33 / 40
		}
		if c.Toe < 0 || c.Toe >= c.Heel || c.Heel >= o.Pixels {
			return fmt.Errorf("layout must satisfy 0 <= toe < heel < pixels")
		}
		if math.IsNaN(c.Tilt) || math.IsInf(c.Tilt, 0) || c.Tilt < -1 || c.Tilt > 1 {
			return fmt.Errorf("--tilt must be between -1 and 1")
		}
		if c.StompEvery < 0 || c.StompEvery > time.Hour || c.StompEvery > 0 && c.StompEvery < time.Millisecond {
			return fmt.Errorf("--stomp-every must be 0 or between 1ms and 1h")
		}
		if c.Motion && (c.Tilt != 0 || c.StompEvery != 0) {
			return fmt.Errorf("--motion cannot be combined with simulated --tilt or --stomp-every")
		}
		if c.LogMotion && !c.Motion {
			return fmt.Errorf("--log-motion requires --motion")
		}
		if c.LogMotion && o.BuildOnly {
			return fmt.Errorf("--log-motion needs an upload, so it can't be combined with --build-only")
		}
	}
	if c.Lit == -1 {
		c.Lit = o.Pixels
	}
	if c.Lit < 0 || c.Lit > o.Pixels {
		return fmt.Errorf("--lit must be between 0 and --pixels")
	}
	if c.Interval < time.Millisecond || c.Interval > time.Hour {
		return fmt.Errorf("--interval must be between 1ms and 1h")
	}
	palette := map[string]uint32{"white": 0xFFFFFF, "red": 0xFF0000, "green": 0x00FF00, "blue": 0x0000FF}
	color := strings.ToLower(c.Color)
	if color == "cycle" {
		c.ColorCycle = true
	} else if rgb, ok := palette[color]; ok {
		c.ColorRGB = rgb
	} else if len(color) == 7 && color[0] == '#' {
		rgb, err := strconv.ParseUint(color[1:], 16, 24)
		if err != nil {
			return fmt.Errorf("invalid --color: use '#RRGGBB'")
		}
		c.ColorRGB = uint32(rgb)
	} else {
		return fmt.Errorf("invalid --color: use cycle, white, red, green, blue, or '#RRGGBB'")
	}
	return nil
}

// BuildFlags turns a validated test into the macros src/modes/bench.cpp reads.
// config.h requires a valid ring layout even for tests that don't use one, so color
// and off tests get a placeholder. A ring needs two pixels, so a one-pixel test sends
// one extra black pixel, which a one-pixel strip simply never receives.
func BuildFlags(o *Options, c *Config) []string {
	pixels, toe, heel := o.Pixels, c.Toe, c.Heel
	if !c.IsPattern() {
		if pixels < 2 {
			pixels = 2
		}
		toe, heel = 0, pixels-1
	}
	return []string{
		fmt.Sprintf("-DBENCH_TEST=%d", c.Test),
		fmt.Sprintf("-DFIREWALKER_LED_COUNT=%d", pixels),
		fmt.Sprintf("-DFIREWALKER_LED_BRIGHTNESS=%d", o.Brightness),
		fmt.Sprintf("-DFIREWALKER_STRIP_TOE_INDEX=%d", toe),
		fmt.Sprintf("-DFIREWALKER_STRIP_HEEL_INDEX=%d", heel),
		fmt.Sprintf("-DBENCH_LIT_PIXELS=%d", c.Lit),
		fmt.Sprintf("-DBENCH_MOTION=%d", bit(c.Motion)),
		fmt.Sprintf("-DBENCH_LOG_MOTION=%d", bit(c.LogMotion)),
		fmt.Sprintf("-DBENCH_TILT=%sf", strconv.FormatFloat(c.Tilt, 'f', 6, 64)),
		fmt.Sprintf("-DBENCH_STOMP_MS=%dUL", c.StompEvery.Milliseconds()),
		fmt.Sprintf("-DBENCH_INTERVAL_MS=%dUL", c.Interval.Milliseconds()),
		fmt.Sprintf("-DBENCH_COLOR_CYCLE=%d", bit(c.ColorCycle)),
		fmt.Sprintf("-DBENCH_COLOR_RGB=0x%06XUL", c.ColorRGB),
	}
}

func bit(value bool) int {
	if value {
		return 1
	}
	return 0
}
