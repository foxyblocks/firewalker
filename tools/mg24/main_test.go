package main

import (
	"slices"
	"strings"
	"testing"
	"time"
)

const deviceList = `[
  {"port": "/dev/cu.debug-console", "description": "n/a", "hwid": "n/a"},
  {"port": "/dev/cu.usbmodem111", "description": "Other", "hwid": "USB VID:PID=239A:80F1 SER=FEATHER LOCATION=1-1"},
  {"port": "/dev/cu.usbmodem572C60FA3", "description": "XIAO", "hwid": "USB VID:PID=2886:0062 SER=572C60FA LOCATION=2-1"},
  {"port": "/dev/cu.usbmodemAAAA1", "description": "XIAO", "hwid": "USB VID:PID=2886:0062 SER=AAAA LOCATION=2-2"}
]`

func TestParseBoardsKeepsOnlyMG24Boards(t *testing.T) {
	boards, err := parseBoards([]byte(deviceList))
	if err != nil {
		t.Fatal(err)
	}
	want := []board{{"/dev/cu.usbmodem572C60FA3", "572C60FA"}, {"/dev/cu.usbmodemAAAA1", "AAAA"}}
	if !slices.Equal(boards, want) {
		t.Fatalf("got %v, want %v", boards, want)
	}
}

func TestSelectBoardNeverGuesses(t *testing.T) {
	left := board{"/dev/cu.left", "LEFT"}
	right := board{"/dev/cu.right", "RIGHT"}
	tests := []struct {
		name         string
		boards       []board
		port, serial string
		want         board
		wantErr      string
	}{
		{name: "one board needs no selection", boards: []board{left}, want: left},
		{name: "two boards refuse to guess", boards: []board{left, right}, wantErr: "select one"},
		{name: "serial picks a board", boards: []board{left, right}, serial: "RIGHT", want: right},
		{name: "port picks a board", boards: []board{left, right}, port: "/dev/cu.left", want: left},
		{name: "unknown serial fails", boards: []board{left, right}, serial: "NOPE", wantErr: "no matching"},
		{name: "a selection can't fall through to the other board", boards: []board{left}, serial: "RIGHT", wantErr: "no matching"},
		{name: "no boards fails", wantErr: "no matching"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := selectBoard(test.boards, test.port, test.serial)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("got error %v, want it to mention %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}

func validConfig(test int) (*options, *testConfig) {
	return &options{pixels: 160, brightness: 16},
		&testConfig{test: test, toe: -1, heel: -1, lit: -1, color: "cycle", interval: 500 * time.Millisecond}
}

func TestValidateRejectsConflictingFlags(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*options, *testConfig)
	}{
		{"no pixels", func(o *options, _ *testConfig) { o.pixels = 0 }},
		{"too many pixels", func(o *options, _ *testConfig) { o.pixels = 5000 }},
		{"no brightness", func(o *options, _ *testConfig) { o.brightness = 0 }},
		{"motion with simulated tilt", func(_ *options, c *testConfig) { c.motion, c.tilt = true, 0.5 }},
		{"motion with timed impacts", func(_ *options, c *testConfig) { c.motion, c.stompEvery = true, time.Second }},
		{"logs without motion", func(_ *options, c *testConfig) { c.logMotion = true }},
		{"logs with no upload", func(o *options, c *testConfig) { c.motion, c.logMotion, o.buildOnly = true, true, true }},
		{"both port and serial", func(o *options, _ *testConfig) { o.port, o.serial = "a", "b" }},
		{"toe past heel", func(_ *options, c *testConfig) { c.toe, c.heel = 100, 50 }},
		{"tilt out of range", func(_ *options, c *testConfig) { c.tilt = 2 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			o, c := validConfig(testFlow)
			test.mutate(o, c)
			if err := validate(o, c); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestValidateDefaultsLayoutFromStripLength(t *testing.T) {
	o, c := validConfig(testFlow)
	if err := validate(o, c); err != nil {
		t.Fatal(err)
	}
	if c.toe != 52 || c.heel != 132 {
		t.Fatalf("got toe=%d heel=%d, want the 160-pixel layout", c.toe, c.heel)
	}
}

func TestValidateParsesColors(t *testing.T) {
	o, c := validConfig(testColor)
	c.color = "#FF8000"
	if err := validate(o, c); err != nil {
		t.Fatal(err)
	}
	if c.colorCycle || c.colorRGB != 0xFF8000 {
		t.Fatalf("got cycle=%t rgb=%06X", c.colorCycle, c.colorRGB)
	}
	c.color = "chartreuse"
	if err := validate(o, c); err == nil {
		t.Fatal("expected an unknown color to fail")
	}
}

func TestBuildFlagsDescribeTheTest(t *testing.T) {
	o, c := validConfig(testFireTrail)
	c.stompEvery = 2 * time.Second
	if err := validate(o, c); err != nil {
		t.Fatal(err)
	}
	flags := buildFlags(o, c)
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
	o, c := validConfig(testColor)
	o.pixels = 1
	if err := validate(o, c); err != nil {
		t.Fatal(err)
	}
	flags := buildFlags(o, c)
	for _, want := range []string{"-DFIREWALKER_STRIP_TOE_INDEX=0", "-DFIREWALKER_STRIP_HEEL_INDEX=1", "-DFIREWALKER_LED_COUNT=2", "-DBENCH_LIT_PIXELS=1"} {
		if !slices.Contains(flags, want) {
			t.Errorf("missing %s in %v", want, flags)
		}
	}
}
