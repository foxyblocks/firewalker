package tui

import (
	"slices"
	"strings"
	"testing"

	"firewalker/cli/internal/bench"
)

var testConfigLayout = bench.StripLayout{Pixels: 160, Toe: 52, Heel: 132}

func newTestForm() *benchForm {
	form := newBenchForm(testConfigLayout)
	form.setLayout(bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}, "saved on 3ED8")
	return form
}

func (f *benchForm) focusOn(t *testing.T, field fieldID) {
	t.Helper()
	if !slices.Contains(f.fields(), field) {
		t.Fatalf("field %v isn't showing: %v", field, f.fields())
	}
	f.focus = field
}

func TestFormPreviewIsTheMatchingCommand(t *testing.T) {
	form := newTestForm()
	if got := form.preview(""); got != "./cli flow --brightness 16" {
		t.Fatalf("got %q", got)
	}
	form.values[fieldTilt] = "-0.5"
	form.values[fieldStomp] = "2s"
	if got := form.preview(""); got != "./cli flow --tilt=-0.5 --stomp-every 2s --brightness 16" {
		t.Fatalf("got %q", got)
	}
	if got := form.preview("99C817E5"); !strings.HasSuffix(got, "--serial 99C817E5") {
		t.Fatalf("got %q", got)
	}
}

func TestFormOnlyShowsFieldsForTheSelectedTest(t *testing.T) {
	tests := []struct {
		name   string
		test   int
		motion bool
		color  string
		want   []fieldID
	}{
		{"simulated flow", bench.TestFlow, false, "cycle", []fieldID{fieldTest, fieldInput, fieldTilt, fieldStomp, fieldLEDs, fieldToe, fieldHeel, fieldBrightness}},
		{"flow on motion", bench.TestFlow, true, "cycle", []fieldID{fieldTest, fieldInput, fieldLogMotion, fieldLEDs, fieldToe, fieldHeel, fieldBrightness}},
		{"simulated fire-trail", bench.TestFireTrail, false, "cycle", []fieldID{fieldTest, fieldInput, fieldTilt, fieldStomp, fieldLEDs, fieldToe, fieldHeel, fieldBrightness}},
		{"color cycle", bench.TestColor, false, "cycle", []fieldID{fieldTest, fieldColor, fieldInterval, fieldLit, fieldBrightness}},
		{"fixed color has no interval", bench.TestColor, false, "red", []fieldID{fieldTest, fieldColor, fieldLit, fieldBrightness}},
		{"off", bench.TestOff, false, "cycle", []fieldID{fieldTest}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			form := newTestForm()
			form.test, form.motion = test.test, test.motion
			form.values[fieldColor] = test.color
			if got := form.fields(); !slices.Equal(got, test.want) {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}

// Everything goes through the same checks as the subcommands, so an impossible test
// can't be submitted from the form.
func TestFormReportsAnImpossibleTest(t *testing.T) {
	form := newTestForm()
	form.values[fieldToe] = "48"
	if _, _, err := form.build(""); err == nil || !strings.Contains(err.Error(), "different pixels") {
		t.Fatalf("got %v", err)
	}
	form = newTestForm()
	form.values[fieldLEDs] = "lots"
	if _, _, err := form.build(""); err == nil || !strings.Contains(err.Error(), "LEDs") {
		t.Fatalf("got %v", err)
	}
	if !strings.HasPrefix(form.preview(""), "✗") {
		t.Fatalf("preview = %q", form.preview(""))
	}
}

func TestFormBuildsTheSameTestAsTheFlags(t *testing.T) {
	form := newTestForm()
	form.values[fieldTilt] = "0.25"
	o, c, err := form.build("99C817E5")
	if err != nil {
		t.Fatal(err)
	}
	if o.Pixels != 94 || o.Brightness != 16 || o.Serial != "99C817E5" {
		t.Fatalf("options = %+v", o)
	}
	if c.Toe != 86 || c.Heel != 48 || c.Tilt != 0.25 || c.Name != "flow" {
		t.Fatalf("config = %+v", c)
	}
}

func TestChoicesChangeWithLeftAndRight(t *testing.T) {
	form := newTestForm()
	form.focusOn(t, fieldTest)
	form.adjust(1)
	if form.test != bench.TestFireTrail {
		t.Fatalf("test = %d", form.test)
	}
	form.adjust(-1)
	form.adjust(-1)
	if form.test != bench.TestOff {
		t.Fatalf("wrapping back: test = %d", form.test)
	}

	form = newTestForm()
	form.focusOn(t, fieldInput)
	form.adjust(1)
	if !form.motion {
		t.Fatal("expected motion")
	}
	// The field under the cursor can disappear when the input changes. Focus has to land
	// somewhere that's still showing.
	form.focusOn(t, fieldLogMotion)
	form.motion = false
	if got := form.focused(); got != fieldTest {
		t.Fatalf("focused = %v", got)
	}
}

func TestNumbersNudgeWithLeftAndRight(t *testing.T) {
	form := newTestForm()
	form.focusOn(t, fieldBrightness)
	form.adjust(1)
	if form.values[fieldBrightness] != "17" {
		t.Fatalf("brightness = %q", form.values[fieldBrightness])
	}
	form.focusOn(t, fieldTilt)
	form.adjust(-1)
	if form.values[fieldTilt] != "-0.05" {
		t.Fatalf("tilt = %q", form.values[fieldTilt])
	}
	form.focusOn(t, fieldStomp)
	form.adjust(1)
	if form.values[fieldStomp] != "500ms" {
		t.Fatalf("stomp = %q", form.values[fieldStomp])
	}
	form.adjust(-1)
	form.adjust(-1)
	if form.values[fieldStomp] != "0s" {
		t.Fatalf("stomp can't go below zero: %q", form.values[fieldStomp])
	}
}

// Fire trails only appear on a stomp, so fire-trail starts with a timer. That shouldn't
// overwrite a timer someone already chose.
func TestSwitchingTestsKeepsAChosenTimer(t *testing.T) {
	form := newTestForm()
	form.focusOn(t, fieldTest)
	form.adjust(1)
	if form.values[fieldStomp] != "1s" {
		t.Fatalf("stomp = %q", form.values[fieldStomp])
	}
	form.adjust(-1)
	if form.values[fieldStomp] != "0s" {
		t.Fatalf("stomp = %q", form.values[fieldStomp])
	}
	form.values[fieldStomp] = "3s"
	form.adjust(1)
	if form.values[fieldStomp] != "3s" {
		t.Fatalf("stomp = %q", form.values[fieldStomp])
	}
}

func TestColorTestsRunOnTheConfiguredLength(t *testing.T) {
	form := newTestForm()
	form.test = bench.TestColor
	o, c, err := form.build("")
	if err != nil {
		t.Fatal(err)
	}
	if o.Pixels != testConfigLayout.Pixels || c.Lit != testConfigLayout.Pixels {
		t.Fatalf("pixels = %d lit = %d", o.Pixels, c.Lit)
	}
	if got := form.preview(""); got != "./cli color --brightness 16" {
		t.Fatalf("got %q", got)
	}
}

// A layout edited for one test stays until it's put back, but a boot reporting a new
// saved layout shouldn't overwrite an edit in progress.
func TestSavedLayoutUpdatesUnlessEdited(t *testing.T) {
	form := newTestForm()
	form.setLayout(bench.StripLayout{Pixels: 107, Toe: 72, Heel: 19}, "saved on 3EB5")
	if form.values[fieldLEDs] != "107" || form.layoutNote() != "saved on 3EB5" {
		t.Fatalf("leds = %q note = %q", form.values[fieldLEDs], form.layoutNote())
	}
	form.values[fieldToe] = "70"
	if form.layoutNote() != "edited for this test" {
		t.Fatalf("note = %q", form.layoutNote())
	}
	form.setLayout(bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}, "saved on 3ED8")
	if form.values[fieldToe] != "70" {
		t.Fatalf("toe = %q", form.values[fieldToe])
	}
	form.resetLayout(bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}, "saved on 3ED8")
	if form.values[fieldToe] != "86" || form.layoutNote() != "saved on 3ED8" {
		t.Fatalf("toe = %q note = %q", form.values[fieldToe], form.layoutNote())
	}
}
