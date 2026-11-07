package protocol

import "testing"

func TestClassifyAudioKeepsRawCaptureAndTuningSeparate(t *testing.T) {
	line := Classify(`{"t":"audio","ready":true,"level":0.52,"rms":92.3,"mean":703.11,"low":532,"high":879,"blocks":42,"captureUs":15687}`)
	if line.Kind != KindAudio || line.Audio == nil || line.Audio.RMS != 92.3 || line.Audio.Blocks != 42 || line.Audio.CaptureUs != 15687 {
		t.Fatalf("audio = %+v", line)
	}
	config := Classify(`{"t":"audio-config","ready":true,"noiseFloor":8,"sensitivity":74,"calibrating":false,"saved":true}`)
	if config.Kind != KindAudioConfig || config.AudioConfig == nil || config.AudioConfig.Sensitivity != 74 {
		t.Fatalf("audio config = %+v", config)
	}
}

func TestClassifyStatusKeepsTheLayoutOfProtoTwo(t *testing.T) {
	line := Classify(`{"t":"status","proto":2,"id":"3ED8","pattern":"flow","lit":"flow","brightness":24,"maxBrightness":64,"sensor":"ok","tilt":0.12,"calibrated":true,"neutralDeg":1.56,"heelDeg":-18.40,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":3,"debug":false,"ble":true,"leds":94,"maxLeds":160,"toe":86,"heel":48,"preview":false}`)
	if line.Kind != KindStatus || line.Status == nil {
		t.Fatalf("got %+v, want a status", line)
	}
	s := line.Status
	if s.ID != "3ED8" || s.Proto != 2 || s.Brightness != 24 || s.Saves != 3 || !s.BLE {
		t.Fatalf("got %+v", s)
	}
	if s.HeelDeg == nil || *s.HeelDeg != -18.40 {
		t.Fatalf("heelDeg = %v, want -18.40", s.HeelDeg)
	}
	if s.ToeDeg != nil {
		t.Fatalf("toeDeg = %v, want nil until captured", *s.ToeDeg)
	}
	layout, ok := s.Layout()
	if !ok || layout != (Layout{LEDs: 94, Toe: 86, Heel: 48}) {
		t.Fatalf("layout = %+v, %t", layout, ok)
	}
}

// A boot on older firmware answers without layout fields. That's still an app that
// replied, but it can't say where its toe and heel are.
func TestClassifyStatusToleratesProtoOne(t *testing.T) {
	line := Classify(`{"t":"status","proto":1,"id":"3EB5","pattern":"flow","lit":"flow","brightness":16,"maxBrightness":64,"sensor":"ok","tilt":0.00,"calibrated":false,"neutralDeg":0.00,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":false}`)
	if line.Kind != KindStatus {
		t.Fatalf("got %+v, want a status", line)
	}
	if _, ok := line.Status.Layout(); ok {
		t.Fatal("a proto 1 status has no layout")
	}
	if line.Status.ID != "3EB5" {
		t.Fatalf("id = %q", line.Status.ID)
	}
}

func TestClassifyRepliesByType(t *testing.T) {
	tests := []struct {
		name  string
		raw   string
		kind  Kind
		check func(t *testing.T, line Line)
	}{
		{"successful ack", `{"t":"ack","cmd":"brightness","ok":true}`, KindAck, func(t *testing.T, line Line) {
			if line.Ack == nil || line.Ack.Cmd != "brightness" || !line.Ack.OK {
				t.Fatalf("got %+v", line.Ack)
			}
		}},
		{"rejected ack", `{"t":"ack","cmd":"strip","ok":false,"error":"same-pixel"}`, KindAck, func(t *testing.T, line Line) {
			if line.Ack == nil || line.Ack.OK || line.Ack.Error != "same-pixel" {
				t.Fatalf("got %+v", line.Ack)
			}
		}},
		{"motion", `{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":true,"strength":0.71}`, KindMotion, func(t *testing.T, line Line) {
			if line.Motion == nil || line.Motion.AccelPeak != 10.31 || !line.Motion.Stomp || line.Motion.Strength != 0.71 {
				t.Fatalf("got %+v", line.Motion)
			}
		}},
		{"calibrate failure", `{"t":"calibrate","pose":"heel","state":"failed","reason":"motion"}`, KindCalibrate, func(t *testing.T, line Line) {
			if line.Calibrate == nil || line.Calibrate.Pose != "heel" || line.Calibrate.Reason != "motion" {
				t.Fatalf("got %+v", line.Calibrate)
			}
		}},
		{"patterns", `{"t":"patterns","list":["flow","fire-trail"]}`, KindPatterns, func(t *testing.T, line Line) {
			if len(line.Patterns) != 2 || line.Patterns[1] != "fire-trail" {
				t.Fatalf("got %+v", line.Patterns)
			}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			line := Classify(test.raw)
			if line.Kind != test.kind {
				t.Fatalf("kind = %v, want %v", line.Kind, test.kind)
			}
			test.check(t, line)
		})
	}
}

// Firmware logs share the port with replies, so anything that isn't a reply we know
// has to come through untouched instead of being dropped or failing.
func TestClassifyTreatsEverythingElseAsALog(t *testing.T) {
	for _, raw := range []string{
		"[firewalker] stomp -> trail (2 active)",
		"[imu] tilt=0.05 accel=10.18",
		"",
		`{"t":"status"`,
		`{"t":"something-new","value":1}`,
		`{"no":"type"}`,
		`[1,2,3]`,
		`{"t":"status","proto":"not a number"}`,
	} {
		line := Classify(raw)
		if line.Kind != KindLog {
			t.Errorf("Classify(%q) = %v, want a log", raw, line.Kind)
		}
		if line.Raw != raw {
			t.Errorf("Classify(%q) kept raw %q", raw, line.Raw)
		}
	}
}

func TestCompletionsFollowWhatWasTyped(t *testing.T) {
	tests := []struct {
		typed string
		want  []string
	}{
		{"pat", []string{"patterns", "pattern flow", "pattern fire-trail", "pattern off"}},
		{"strip p", []string{"strip preview on", "strip preview off"}},
		{"BRI", []string{"brightness "}},
		{"nope", nil},
	}
	for _, test := range tests {
		got := Completions(test.typed)
		if len(got) != len(test.want) {
			t.Errorf("Completions(%q) = %q, want %q", test.typed, got, test.want)
			continue
		}
		for i := range got {
			if got[i] != test.want[i] {
				t.Errorf("Completions(%q) = %q, want %q", test.typed, got, test.want)
				break
			}
		}
	}
	if got := Completions(""); len(got) < 10 {
		t.Errorf("an empty line should offer every command, got %q", got)
	}
}
