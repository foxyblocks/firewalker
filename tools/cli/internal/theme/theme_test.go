package theme

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"firewalker/cli/internal/protocol"
)

// Output captured to a file or a pipe is for scripts, so it can't carry color codes.
func TestOutputThatIsNotATerminalGetsNoColor(t *testing.T) {
	th := New(&bytes.Buffer{})
	if th.Colored() {
		t.Fatal("a buffer isn't a terminal")
	}
	line := th.Line(time.Date(2026, 11, 4, 22, 14, 2, 0, time.UTC), KindError, "upload failed")
	if strings.Contains(line, "\x1b") {
		t.Fatalf("got escape codes in %q", line)
	}
	if !strings.Contains(line, "22:14:02") || !strings.Contains(line, "✗") || !strings.Contains(line, "upload failed") {
		t.Fatalf("got %q", line)
	}
}

func TestDescribeMakesRepliesReadable(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		kind Kind
		want string
	}{
		{"accepted command", `{"t":"ack","cmd":"debug","ok":true}`, KindOK, "debug"},
		{"rejected command", `{"t":"ack","cmd":"strip","ok":false,"error":"same-pixel"}`, KindError, "strip: same-pixel"},
		{"status with a layout", `{"t":"status","proto":2,"id":"3ED8","pattern":"flow","brightness":24,"maxBrightness":64,"leds":94,"toe":86,"heel":48}`, KindOK, "status 3ED8 · flow · brightness 24/64 · 94 LEDs, toe 86, heel 48"},
		{"status from older firmware", `{"t":"status","proto":1,"id":"3EB5","pattern":"off","brightness":16,"maxBrightness":64}`, KindOK, "status 3EB5 · off · brightness 16/64"},
		{"patterns", `{"t":"patterns","list":["flow","fire-trail"]}`, KindOK, "patterns: flow, fire-trail"},
		{"pose saved", `{"t":"calibrate","pose":"heel","state":"ok","angleDeg":-18.40,"tilt":-1.00}`, KindOK, "calibrate heel: ok, -18.4°"},
		{"pose failed", `{"t":"calibrate","pose":"heel","state":"failed","reason":"motion"}`, KindError, "calibrate heel: failed, motion"},
		{"motion", `{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":false,"strength":0.00}`, KindMotion, "tilt +0.05 · angle 1.4° · accel 10.2 · peak 10.3 · gyro 0.03"},
		{"motion with a stomp", `{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":30.5,"gyro":0.03,"stomp":true,"strength":0.71}`, KindMotion, "tilt +0.05 · angle 1.4° · accel 10.2 · peak 30.5 · gyro 0.03 · stomp 0.71"},
		{"firmware log", `[firewalker] stomp -> trail (2 active)`, KindFirmware, "[firewalker] stomp -> trail (2 active)"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			kind, text := Describe(protocol.Classify(test.raw))
			if kind != test.kind || text != test.want {
				t.Fatalf("got %v %q, want %v %q", kind, text, test.kind, test.want)
			}
		})
	}
}
