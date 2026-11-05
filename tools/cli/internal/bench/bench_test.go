package bench

import (
	"slices"
	"testing"
	"time"
)

func validConfig(test int) (*Options, *Config) {
	return &Options{Pixels: 160, Brightness: 16},
		&Config{Test: test, Toe: -1, Heel: -1, Lit: -1, Color: "cycle", Interval: 500 * time.Millisecond}
}

func TestValidateRejectsConflictingFlags(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Options, *Config)
	}{
		{"no pixels", func(o *Options, _ *Config) { o.Pixels = 0 }},
		{"too many pixels", func(o *Options, _ *Config) { o.Pixels = 5000 }},
		{"no brightness", func(o *Options, _ *Config) { o.Brightness = 0 }},
		{"motion with simulated tilt", func(_ *Options, c *Config) { c.Motion, c.Tilt = true, 0.5 }},
		{"motion with timed impacts", func(_ *Options, c *Config) { c.Motion, c.StompEvery = true, time.Second }},
		{"logs without motion", func(_ *Options, c *Config) { c.LogMotion = true }},
		{"logs with no upload", func(o *Options, c *Config) { c.Motion, c.LogMotion, o.BuildOnly = true, true, true }},
		{"both port and serial", func(o *Options, _ *Config) { o.Port, o.Serial = "a", "b" }},
		{"toe and heel on one pixel", func(_ *Options, c *Config) { c.Toe, c.Heel = 50, 50 }},
		{"heel past the end", func(_ *Options, c *Config) { c.Toe, c.Heel = 50, 160 }},
		{"toe past the end", func(_ *Options, c *Config) { c.Toe, c.Heel = 160, 50 }},
		{"negative toe", func(_ *Options, c *Config) { c.Toe, c.Heel = -5, 50 }},
		{"debug with no upload", func(o *Options, _ *Config) { o.Debug, o.BuildOnly = true, true }},
		{"tilt out of range", func(_ *Options, c *Config) { c.Tilt = 2 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			o, c := validConfig(TestFlow)
			test.mutate(o, c)
			if err := Validate(o, c); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

// Fire-trail starts from the part of the boot that's down, so a simulated tilt picks its origin.
func TestValidateAllowsFireTrailTilt(t *testing.T) {
	o, c := validConfig(TestFireTrail)
	c.Tilt = -1
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
}

func TestValidateDefaultsLayoutFromStripLength(t *testing.T) {
	o, c := validConfig(TestFlow)
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
	if c.Toe != 52 || c.Heel != 132 {
		t.Fatalf("got toe=%d heel=%d, want the 160-pixel layout", c.Toe, c.Heel)
	}
}

// A mirrored boot runs the ring the other way around, so the heel can come first. A real
// boot is set up this way: 94 LEDs, toe 86, heel 48. Firmware's stripLayoutValid has the
// same rule.
func TestValidateAcceptsToeAndHeelInEitherOrder(t *testing.T) {
	o, c := validConfig(TestFlow)
	o.Pixels, c.Toe, c.Heel = 94, 86, 48
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
	flags := BuildFlags(o, c)
	for _, want := range []string{"-DFIREWALKER_LED_COUNT=94", "-DFIREWALKER_STRIP_TOE_INDEX=86", "-DFIREWALKER_STRIP_HEEL_INDEX=48"} {
		if !slices.Contains(flags, want) {
			t.Errorf("missing %s in %v", want, flags)
		}
	}
}

// CheckInputs runs before anything talks to a board, when the strip length may not be
// known yet, so it can't depend on it. It still catches a bad flag early.
func TestCheckInputsCatchesBadFlagsBeforeTheStripLengthIsKnown(t *testing.T) {
	o, c := validConfig(TestFlow)
	o.Pixels = 0
	if err := CheckInputs(o, c); err != nil {
		t.Fatalf("a missing strip length isn't an input problem: %v", err)
	}
	c.Motion, c.Tilt = true, 0.5
	if err := CheckInputs(o, c); err == nil {
		t.Fatal("expected motion plus a simulated tilt to fail")
	}
}

func TestPickLayoutPrefersTheBootThenItsMemoryThenConfig(t *testing.T) {
	config := StripLayout{Pixels: 160, Toe: 52, Heel: 132}
	saved := StripLayout{Pixels: 94, Toe: 86, Heel: 48}
	remembered := StripLayout{Pixels: 110, Toe: 36, Heel: 91}
	tests := []struct {
		name       string
		choices    LayoutChoices
		want       StripLayout
		wantSource LayoutSource
	}{
		{"the boot's reply wins", LayoutChoices{Boot: &saved, Remembered: &remembered, Config: config}, saved, SourceBoot},
		{"a board that didn't answer uses what it last said", LayoutChoices{Remembered: &remembered, Config: config}, remembered, SourceRemembered},
		{"a board never seen before falls back to config.h", LayoutChoices{Config: config}, config, SourceConfig},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := PickLayout(test.choices)
			if got.Layout != test.want || got.Source != test.wantSource {
				t.Fatalf("got %+v, want %+v from %v", got, test.want, test.wantSource)
			}
		})
	}
}

func TestApplyLayoutKeepsExplicitToeAndHeel(t *testing.T) {
	o, c := validConfig(TestFlow)
	o.Pixels = 0
	c.Toe = 10
	ApplyLayout(o, c, StripLayout{Pixels: 94, Toe: 86, Heel: 48})
	if o.Pixels != 94 || c.Toe != 10 || c.Heel != 48 {
		t.Fatalf("got pixels=%d toe=%d heel=%d", o.Pixels, c.Toe, c.Heel)
	}
}

func TestValidateParsesColors(t *testing.T) {
	o, c := validConfig(TestColor)
	c.Color = "#FF8000"
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
	if c.ColorCycle || c.ColorRGB != 0xFF8000 {
		t.Fatalf("got cycle=%t rgb=%06X", c.ColorCycle, c.ColorRGB)
	}
	c.Color = "chartreuse"
	if err := Validate(o, c); err == nil {
		t.Fatal("expected an unknown color to fail")
	}
}

func TestParseStripLayoutReadsConfig(t *testing.T) {
	config := `
#ifndef FIREWALKER_LED_COUNT
#define FIREWALKER_LED_COUNT 110
#endif
#define FIREWALKER_STRIP_TOE_INDEX 36
#define FIREWALKER_STRIP_HEEL_INDEX 91
`
	layout, err := ParseStripLayout(config)
	if err != nil {
		t.Fatal(err)
	}
	if layout != (StripLayout{Pixels: 110, Toe: 36, Heel: 91}) {
		t.Fatalf("got %+v", layout)
	}
	if _, err := ParseStripLayout("#define FIREWALKER_LED_COUNT 110"); err == nil {
		t.Fatal("expected a missing toe index to fail")
	}
}

func TestBuildFlagsDescribeTheTest(t *testing.T) {
	o, c := validConfig(TestFireTrail)
	c.StompEvery = 2 * time.Second
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
	flags := BuildFlags(o, c)
	for _, want := range []string{
		"-DBENCH_TEST=1",
		"-DFIREWALKER_LED_COUNT=160",
		"-DFIREWALKER_LED_BRIGHTNESS=16",
		"-DFIREWALKER_STRIP_TOE_INDEX=52",
		"-DFIREWALKER_STRIP_HEEL_INDEX=132",
		"-DBENCH_STOMP_MS=2000UL",
	} {
		if !slices.Contains(flags, want) {
			t.Errorf("missing %s in %v", want, flags)
		}
	}
}

func TestBuildFlagsGiveShortColorTestsAValidLayout(t *testing.T) {
	o, c := validConfig(TestColor)
	o.Pixels = 1
	if err := Validate(o, c); err != nil {
		t.Fatal(err)
	}
	flags := BuildFlags(o, c)
	for _, want := range []string{"-DFIREWALKER_STRIP_TOE_INDEX=0", "-DFIREWALKER_STRIP_HEEL_INDEX=1", "-DFIREWALKER_LED_COUNT=2", "-DBENCH_LIT_PIXELS=1"} {
		if !slices.Contains(flags, want) {
			t.Errorf("missing %s in %v", want, flags)
		}
	}
}

func TestCommandLineShowsOnlyWhatDiffersFromTheDefaults(t *testing.T) {
	saved := StripLayout{Pixels: 94, Toe: 86, Heel: 48}
	tests := []struct {
		name   string
		test   int
		mutate func(*Options, *Config)
		want   string
	}{
		{"simulated flow on the saved layout", TestFlow, func(o *Options, c *Config) {
			c.Tilt, c.StompEvery = -0.5, 2*time.Second
		}, "./cli flow --tilt=-0.5 --stomp-every 2s --brightness 16"},
		{"motion with logs", TestFlow, func(o *Options, c *Config) {
			c.Motion, c.LogMotion = true, true
		}, "./cli flow --motion --log-motion --brightness 16"},
		{"a layout edited for this test", TestFlow, func(o *Options, c *Config) {
			o.Pixels, c.Toe = 90, 80
		}, "./cli flow --pixels 90 --toe 80 --heel 48 --brightness 16"},
		{"fire-trail's usual timer is the default", TestFireTrail, func(o *Options, c *Config) {
			c.StompEvery = time.Second
		}, "./cli fire-trail --brightness 16"},
		{"fire-trail with its timer off has to say so", TestFireTrail, func(o *Options, c *Config) {
			c.StompEvery = 0
		}, "./cli fire-trail --stomp-every 0s --brightness 16"},
		{"a color needs quoting", TestColor, func(o *Options, c *Config) {
			c.Color, c.Lit = "#ff8000", 10
		}, "./cli color --lit 10 --color '#ff8000' --brightness 16"},
		{"off has nothing to set", TestOff, func(o *Options, c *Config) {}, "./cli off"},
		{"two boots need a serial", TestFlow, func(o *Options, c *Config) {
			o.Serial = "99C817E5"
		}, "./cli flow --brightness 16 --serial 99C817E5"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			o, c := validConfig(test.test)
			c.Name = TestNames[test.test]
			o.Pixels, c.Toe, c.Heel = saved.Pixels, saved.Toe, saved.Heel
			if !c.IsPattern() {
				c.Toe, c.Heel = -1, -1
			}
			test.mutate(o, c)
			if err := Validate(o, c); err != nil {
				t.Fatal(err)
			}
			if got := CommandLine(Args(o, c, saved)); got != test.want {
				t.Fatalf("got  %s\nwant %s", got, test.want)
			}
		})
	}
}
