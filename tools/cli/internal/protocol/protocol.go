// Package protocol reads what a boot says over USB. The firmware's replies are one
// JSON object per line, and they share the port with its plain-text log lines, so
// every line gets sorted into a reply type or "just a log". docs/remote-protocol.md is
// the reference for these shapes, and the firmware side is
// include/firewalker_remote_protocol.h.
//
// This package is pure: no ports, no terminals. The subcommands use it to read a
// boot's saved strip layout, and the TUI uses it to fill the Boot screen and color the
// log.
package protocol

import (
	"encoding/json"
	"strings"
)

// ExpectedProto is the newest protocol this tool knows. A boot reporting an older one
// still works, but it's missing features, so the TUI suggests flashing the app. Proto 2
// added the saved strip layout.
const ExpectedProto = 2

// Kind says what sort of line a boot sent.
type Kind int

const (
	KindLog Kind = iota
	KindAck
	KindStatus
	KindMotion
	KindCalibrate
	KindPatterns
	KindAudio
	KindAudioConfig
)

// Line is one classified line. Raw always holds the original text, and only the field
// matching Kind is set.
type Line struct {
	Raw         string
	Kind        Kind
	Ack         *Ack
	Status      *Status
	Motion      *Motion
	Calibrate   *Calibrate
	Patterns    []string
	Audio       *Audio
	AudioConfig *AudioConfig
}

// Ack is the reply to any command except `status`.
type Ack struct {
	Cmd   string `json:"cmd"`
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// Status is a boot's report on itself. Treat it as the truth about the boot, rather
// than remembering what was last sent, because a phone may have changed things too.
type Status struct {
	Proto         int      `json:"proto"`
	ID            string   `json:"id"`
	Pattern       string   `json:"pattern"`
	Lit           string   `json:"lit"`
	Brightness    int      `json:"brightness"`
	MaxBrightness int      `json:"maxBrightness"`
	Sensor        string   `json:"sensor"`
	Tilt          float64  `json:"tilt"`
	Calibrated    bool     `json:"calibrated"`
	NeutralDeg    float64  `json:"neutralDeg"`
	HeelDeg       *float64 `json:"heelDeg"` // nil until that pose is captured
	ToeDeg        *float64 `json:"toeDeg"`  // nil until that pose is captured
	Calibration   string   `json:"calibration"`
	Saved         bool     `json:"saved"`
	SaveFailed    bool     `json:"saveFailed"`
	Saves         int      `json:"saves"`
	Debug         bool     `json:"debug"`
	BLE           bool     `json:"ble"`
	LEDs          *int     `json:"leds"` // the layout fields are missing before proto 2
	MaxLEDs       *int     `json:"maxLeds"`
	Toe           *int     `json:"toe"`
	Heel          *int     `json:"heel"`
	Preview       bool     `json:"preview"`
}

// Layout is a boot's saved strip layout: how many pixels its ring has, and which of
// them sit at the toe and heel. Toe and heel can come in either order, because a
// mirrored boot runs the ring the other way around.
type Layout struct{ LEDs, Toe, Heel int }

// Layout returns the boot's saved strip layout. ok is false on proto 1 firmware, which
// doesn't report one.
func (s *Status) Layout() (layout Layout, ok bool) {
	if s.LEDs == nil || s.Toe == nil || s.Heel == nil {
		return Layout{}, false
	}
	return Layout{LEDs: *s.LEDs, Toe: *s.Toe, Heel: *s.Heel}, true
}

// Motion is one live sensor sample, sent about five times a second while debug is on.
type Motion struct {
	Tilt      float64 `json:"tilt"`
	AngleDeg  float64 `json:"angleDeg"`
	Accel     float64 `json:"accel"`
	AccelPeak float64 `json:"accelPeak"`
	Gyro      float64 `json:"gyro"`
	Stomp     bool    `json:"stomp"`
	Strength  float64 `json:"strength"`
	FrameUs   uint32  `json:"frameUs"`
}

// Audio keeps the microphone's raw signal separate from the tuned recipe level.
// Diagnostics compare RMS (the changing signal in ADC counts), not Level, which
// depends on the boot's saved noise floor and sensitivity. Blocks must advance
// to prove these are fresh samples rather than a stalled capture's last value.
type Audio struct {
	Ready     bool    `json:"ready"`
	Level     float64 `json:"level"`
	RMS       float64 `json:"rms"`
	Mean      float64 `json:"mean"`
	Low       int     `json:"low"`
	High      int     `json:"high"`
	Blocks    uint32  `json:"blocks"`
	CaptureUs uint32  `json:"captureUs"`
}

type AudioConfig struct {
	Ready       bool `json:"ready"`
	NoiseFloor  int  `json:"noiseFloor"`
	Sensitivity int  `json:"sensitivity"`
	Calibrating bool `json:"calibrating"`
	Saved       bool `json:"saved"`
}

// Calibrate reports a pose capture's progress.
type Calibrate struct {
	Pose     string  `json:"pose"`
	State    string  `json:"state"`
	AngleDeg float64 `json:"angleDeg"`
	Tilt     float64 `json:"tilt"`
	Reason   string  `json:"reason"`
}

// Classify sorts one line from a boot. It never fails: broken JSON, an unknown reply
// type, or a field of the wrong type all come back as KindLog with the text intact, so
// a newer firmware's replies still show up in the log instead of vanishing.
func Classify(raw string) Line {
	log := Line{Raw: raw, Kind: KindLog}
	if len(raw) == 0 || raw[0] != '{' {
		return log
	}
	var envelope struct {
		Type string `json:"t"`
	}
	if json.Unmarshal([]byte(raw), &envelope) != nil {
		return log
	}

	line := Line{Raw: raw}
	var err error
	switch envelope.Type {
	case "ack":
		line.Kind, line.Ack = KindAck, &Ack{}
		err = json.Unmarshal([]byte(raw), line.Ack)
	case "status":
		line.Kind, line.Status = KindStatus, &Status{}
		err = json.Unmarshal([]byte(raw), line.Status)
	case "motion":
		line.Kind, line.Motion = KindMotion, &Motion{}
		err = json.Unmarshal([]byte(raw), line.Motion)
	case "audio":
		line.Kind, line.Audio = KindAudio, &Audio{}
		err = json.Unmarshal([]byte(raw), line.Audio)
	case "audio-config":
		line.Kind, line.AudioConfig = KindAudioConfig, &AudioConfig{}
		err = json.Unmarshal([]byte(raw), line.AudioConfig)
	case "calibrate":
		line.Kind, line.Calibrate = KindCalibrate, &Calibrate{}
		err = json.Unmarshal([]byte(raw), line.Calibrate)
	case "patterns":
		var list struct {
			List []string `json:"list"`
		}
		err = json.Unmarshal([]byte(raw), &list)
		line.Kind, line.Patterns = KindPatterns, list.List
	default:
		return log
	}
	if err != nil {
		return log
	}
	return line
}

// commands lists what a boot accepts, from the commands table in
// docs/remote-protocol.md. A trailing space means a value comes next. The console uses
// this for tab completion only, so a command that's missing here can still be typed.
var commands = []string{
	"status",
	"patterns",
	"pattern flow", "pattern fire-trail", "pattern off",
	"power on", "power off",
	"brightness ",
	"calibrate neutral", "calibrate heel", "calibrate toe",
	"debug on", "debug off",
	"identify",
	"audio", "audio gain ", "audio calibrate",
	"strip leds ", "strip toe ", "strip heel ",
	"strip preview on", "strip preview off",
}

// Completions returns the commands starting with what's been typed, ignoring case. For
// example, "strip p" offers "strip preview on" and "strip preview off".
func Completions(typed string) []string {
	var matches []string
	typed = strings.ToLower(typed)
	for _, command := range commands {
		if strings.HasPrefix(command, typed) {
			matches = append(matches, command)
		}
	}
	return matches
}
