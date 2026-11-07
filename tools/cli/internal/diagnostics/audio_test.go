package diagnostics_test

import (
	"math"
	"testing"

	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/protocol"
)

func audioPhase(name string, hz int, rms float64, start uint32) diagnostics.Phase {
	p := diagnostics.Phase{Name: name, FrequencyHz: hz}
	for n := uint32(0); n < 6; n++ {
		p.Audio = append(p.Audio, protocol.Audio{Ready: true, RMS: rms, Mean: 710, Low: 500, High: 900, Blocks: start + n, CaptureUs: 15687})
	}
	return p
}

func TestAudioCheckRejectsStalledClippedOrMissingCapture(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func([]diagnostics.Phase)
	}{
		{"capture unavailable", func(p []diagnostics.Phase) { p[1].Audio[0].Ready = false }},
		{"stalled blocks", func(p []diagnostics.Phase) { p[1].Audio[1].Blocks = p[1].Audio[0].Blocks }},
		{"clipping", func(p []diagnostics.Phase) { p[1].Audio[0].High = 4095 }},
		{"invalid signal", func(p []diagnostics.Phase) { p[1].Audio[0].RMS = math.NaN() }},
		{"quiet window missing", func(p []diagnostics.Phase) { p[0].Audio = nil }},
		{"too few samples", func(p []diagnostics.Phase) { p[1].Audio = p[1].Audio[:1] }},
		{"wrong second tone", func(p []diagnostics.Phase) { p[3].FrequencyHz = 1000 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			phases := []diagnostics.Phase{audioPhase("quiet-before", 0, 5, 1), audioPhase("tone-1000Hz", 1000, 90, 7), audioPhase("quiet-between", 0, 5, 13), audioPhase("tone-2000Hz", 2000, 120, 19), audioPhase("quiet-after", 0, 5, 25)}
			test.change(phases)
			if result := diagnostics.CheckAudio(phases, diagnostics.DefaultOptions()); result.Pass || result.Reason == "" {
				t.Fatalf("unsafe pass: %+v", result)
			}
		})
	}
}

func TestAudioCheckDistinguishesToneResponseFromBackground(t *testing.T) {
	for _, test := range []struct {
		name string
		rms  float64
		pass bool
	}{
		{"responsive microphone", 92, true},
		{"blocked microphone", 5.1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			phases := []diagnostics.Phase{
				audioPhase("quiet-before", 0, 5, 1),
				audioPhase("tone-1000Hz", 1000, test.rms, 7),
				audioPhase("quiet-between", 0, 5, 13),
				audioPhase("tone-2000Hz", 2000, test.rms, 19),
				audioPhase("quiet-after", 0, 5, 25),
			}
			result := diagnostics.CheckAudio(phases, diagnostics.DefaultOptions())
			if result.Pass != test.pass || len(result.Tones) != 2 || result.Tones[0].RMS != test.rms {
				t.Fatalf("result = %+v", result)
			}
		})
	}
}
