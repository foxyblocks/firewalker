package tui

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"firewalker/cli/internal/bench"
)

// fieldID names one row of the bench form.
type fieldID int

const (
	fieldTest fieldID = iota
	fieldInput
	fieldTilt
	fieldStomp
	fieldLogMotion
	fieldLEDs
	fieldToe
	fieldHeel
	fieldColor
	fieldInterval
	fieldLit
	fieldBrightness
)

// testOrder is the order the Test row offers its choices in.
var testOrder = []int{bench.TestRainbowPool, bench.TestFireStomp, bench.TestColor, bench.TestOff}

var colorChoices = []string{"cycle", "white", "red", "green", "blue"}

// benchForm is the Bench test screen's state: today's subcommands as a form. Values stay
// as the text the person typed, because something half-typed isn't a number yet. build
// parses them and runs bench.Validate, the same checks the flags go through, so the form
// can't submit anything the subcommands would refuse.
//
// LEDs, toe, and heel here only describe the one test about to be built. They become
// build flags and never touch what the boot has saved. Setting those lives on the phone.
type benchForm struct {
	config bench.StripLayout // include/config.h, for tests that have no ring

	test      int
	motion    bool
	logMotion bool
	values    map[fieldID]string
	focus     fieldID
	saved     bench.StripLayout // the layout a `./cli` run would find by itself
	savedNote string            // where saved came from, such as "saved on 3ED8"
}

func newBenchForm(config bench.StripLayout) *benchForm {
	form := &benchForm{
		config: config,
		test:   bench.TestRainbowPool,
		values: map[fieldID]string{
			fieldTilt:       "0",
			fieldStomp:      "0s",
			fieldBrightness: "16",
			fieldColor:      "cycle",
			fieldInterval:   "500ms",
			fieldLit:        "",
		},
	}
	form.resetLayout(config, "include/config.h")
	return form
}

// fields lists the rows showing right now, which depend on the selected test and input.
func (f *benchForm) fields() []fieldID {
	switch f.test {
	case bench.TestOff:
		return []fieldID{fieldTest}
	case bench.TestColor:
		list := []fieldID{fieldTest, fieldColor}
		if f.values[fieldColor] == "cycle" {
			list = append(list, fieldInterval)
		}
		return append(list, fieldLit, fieldBrightness)
	}
	list := []fieldID{fieldTest, fieldInput}
	if f.motion {
		list = append(list, fieldLogMotion)
	} else {
		list = append(list, fieldTilt, fieldStomp)
	}
	return append(list, fieldLEDs, fieldToe, fieldHeel, fieldBrightness)
}

// focused returns the row with the cursor. A row can vanish while it's focused, such as
// Tilt when the input changes to motion, and the cursor then returns to the top.
func (f *benchForm) focused() fieldID {
	for _, field := range f.fields() {
		if field == f.focus {
			return f.focus
		}
	}
	return fieldTest
}

// move steps the cursor up or down, wrapping at the ends.
func (f *benchForm) move(step int) {
	fields := f.fields()
	position := 0
	for i, field := range fields {
		if field == f.focused() {
			position = i
		}
	}
	f.focus = fields[(position+step+len(fields))%len(fields)]
}

// isEditable says whether a row takes typed text, as opposed to only a choice.
func (f *benchForm) isEditable(field fieldID) bool {
	switch field {
	case fieldTest, fieldInput, fieldLogMotion:
		return false
	}
	return true
}

// adjust handles left and right: the next choice on a choice row, or a small nudge on a
// number. A value that doesn't parse stays as it is for the person to fix.
func (f *benchForm) adjust(step int) {
	switch field := f.focused(); field {
	case fieldTest:
		f.setTest(testOrder[(indexOf(testOrder, f.test)+step+len(testOrder))%len(testOrder)])
	case fieldInput:
		f.motion = !f.motion
		if !f.motion {
			f.logMotion = false
		}
	case fieldLogMotion:
		f.logMotion = !f.logMotion
	case fieldColor:
		next := (indexOf(colorChoices, f.values[fieldColor]) + step + len(colorChoices)) % len(colorChoices)
		f.values[fieldColor] = colorChoices[next]
	case fieldTilt:
		if tilt, err := strconv.ParseFloat(f.values[fieldTilt], 64); err == nil {
			tilt = max(min(tilt+float64(step)*0.05, 1), -1)
			f.values[fieldTilt] = strconv.FormatFloat(tilt, 'f', 2, 64)
		}
	case fieldStomp:
		f.nudgeDuration(fieldStomp, step, 500*time.Millisecond, 0)
	case fieldInterval:
		f.nudgeDuration(fieldInterval, step, 100*time.Millisecond, 100*time.Millisecond)
	case fieldLit:
		lit, err := strconv.Atoi(f.values[fieldLit])
		if f.values[fieldLit] == "" {
			lit, err = f.config.Pixels, nil
		}
		if err == nil {
			f.values[fieldLit] = strconv.Itoa(max(lit+step, 0))
		}
	case fieldLEDs, fieldToe, fieldHeel, fieldBrightness:
		if value, err := strconv.Atoi(f.values[field]); err == nil {
			f.values[field] = strconv.Itoa(max(value+step, 0))
		}
	}
}

func (f *benchForm) nudgeDuration(field fieldID, step int, by, floor time.Duration) {
	if value, err := time.ParseDuration(f.values[field]); err == nil {
		f.values[field] = max(value+time.Duration(step)*by, floor).String()
	}
}

// setTest switches tests. Fire trails only appear on a stomp, so fire-stomp starts with a
// timer, the same default as its subcommand. A timer someone chose stays.
func (f *benchForm) setTest(test int) {
	previous := f.test
	f.test = test
	if f.values[fieldStomp] == defaultStomp(previous) {
		f.values[fieldStomp] = defaultStomp(test)
	}
}

func defaultStomp(test int) string {
	if test == bench.TestFireStomp {
		return "1s"
	}
	return "0s"
}

func indexOf[T comparable](list []T, value T) int {
	for i, item := range list {
		if item == value {
			return i
		}
	}
	return 0
}

// layoutValues is the layout currently in the form, as text.
func layoutValues(layout bench.StripLayout) [3]string {
	return [3]string{strconv.Itoa(layout.Pixels), strconv.Itoa(layout.Toe), strconv.Itoa(layout.Heel)}
}

func (f *benchForm) isEdited() bool {
	return [3]string{f.values[fieldLEDs], f.values[fieldToe], f.values[fieldHeel]} != layoutValues(f.saved)
}

// setLayout takes in a layout the boot just reported. An edit in progress stays where it
// is, because status lines can arrive at any moment and shouldn't undo typing.
func (f *benchForm) setLayout(layout bench.StripLayout, note string) {
	if f.isEdited() {
		f.saved, f.savedNote = layout, note
		return
	}
	f.resetLayout(layout, note)
}

// resetLayout replaces the form's layout outright, for when a different boot is picked.
func (f *benchForm) resetLayout(layout bench.StripLayout, note string) {
	f.saved, f.savedNote = layout, note
	values := layoutValues(layout)
	f.values[fieldLEDs], f.values[fieldToe], f.values[fieldHeel] = values[0], values[1], values[2]
}

// layoutNote says where the form's layout came from.
func (f *benchForm) layoutNote() string {
	if f.isEdited() {
		return "edited for this test"
	}
	return f.savedNote
}

// build turns the form into a validated test. serial goes in the options so the preview
// can name a board when one has to be named.
func (f *benchForm) build(serial string) (*bench.Options, *bench.Config, error) {
	o := &bench.Options{Pixels: f.config.Pixels, Brightness: 16, Serial: serial}
	c := &bench.Config{Name: bench.TestNames[f.test], Test: f.test, Toe: -1, Heel: -1, Lit: -1, Color: "cycle", Interval: 500 * time.Millisecond}

	var err error
	number := func(field fieldID, label string) int {
		value, parseErr := strconv.Atoi(strings.TrimSpace(f.values[field]))
		if parseErr != nil && err == nil {
			err = fmt.Errorf("%s must be a whole number", label)
		}
		return value
	}
	duration := func(field fieldID, label string) time.Duration {
		value, parseErr := time.ParseDuration(strings.TrimSpace(f.values[field]))
		if parseErr != nil && err == nil {
			err = fmt.Errorf("%s must be a time, such as 2s or 500ms", label)
		}
		return value
	}

	if f.test != bench.TestOff {
		o.Brightness = number(fieldBrightness, "Brightness")
	}
	switch f.test {
	case bench.TestRainbowPool, bench.TestFireStomp:
		o.Pixels = number(fieldLEDs, "LEDs")
		c.Toe = number(fieldToe, "Toe")
		c.Heel = number(fieldHeel, "Heel")
		c.Motion, c.LogMotion = f.motion, f.motion && f.logMotion
		if !f.motion {
			tilt, parseErr := strconv.ParseFloat(strings.TrimSpace(f.values[fieldTilt]), 64)
			if parseErr != nil && err == nil {
				err = fmt.Errorf("Tilt must be a number from -1 to 1")
			}
			c.Tilt = tilt
			c.StompEvery = duration(fieldStomp, "Stomp every")
		}
	case bench.TestColor:
		c.Color = strings.TrimSpace(f.values[fieldColor])
		if f.values[fieldLit] != "" {
			c.Lit = number(fieldLit, "Lit")
		}
		if strings.EqualFold(c.Color, "cycle") {
			c.Interval = duration(fieldInterval, "Interval")
		}
	}
	if err != nil {
		return nil, nil, err
	}
	if err := bench.Validate(o, c); err != nil {
		return nil, nil, err
	}
	return o, c, nil
}

// preview is the `./cli` command for what's in the form, or what's wrong with it, which
// starts with ✗. Only pattern tests read the boot's layout, so color and off compare
// against the configured length.
func (f *benchForm) preview(serial string) string {
	o, c, err := f.build(serial)
	if err != nil {
		return "✗ " + err.Error()
	}
	defaults := f.config
	if c.IsPattern() {
		defaults = f.saved
	}
	return bench.CommandLine(bench.Args(o, c, defaults))
}
