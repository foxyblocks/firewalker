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
		{"toe past heel", func(_ *Options, c *Config) { c.Toe, c.Heel = 100, 50 }},
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
