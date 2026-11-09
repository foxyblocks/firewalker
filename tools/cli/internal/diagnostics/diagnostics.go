// Package diagnostics checks the running firmware without installing a build or
// changing saved settings. Sessions own temporary debug streaming; Run collects
// motion and microphone samples while a host player supplies known tones.
// CheckAudio and CheckMotion interpret those samples for both text and JSON output.
// The live dashboard uses the same session and protocol types.
package diagnostics

import (
	"fmt"
	"math"
	"time"

	"firewalker/cli/internal/protocol"
)

const (
	Audio  = "audio"
	Motion = "motion"
	All    = "all"
)

// Options describe a finite bench check. Duration is each quiet or tone window.
// Relative and absolute thresholds prevent a tiny change in ADC noise passing as
// sound. These are repeatable bench criteria, not a calibrated mic sensitivity.
type Options struct {
	Kind            string
	Duration        time.Duration
	Volume          float64
	MinRatio        float64
	MinRise         float64
	MinSamples      int
	RequireMovement bool
}

func DefaultOptions() Options {
	return Options{Kind: All, Duration: 2 * time.Second, Volume: 0.4, MinRatio: 3, MinRise: 8, MinSamples: 5}
}

func (o Options) Validate() error {
	if o.Kind != Audio && o.Kind != Motion && o.Kind != All {
		return fmt.Errorf("unknown diagnostic %q", o.Kind)
	}
	if o.Duration < time.Second || o.Duration > time.Minute {
		return fmt.Errorf("--duration must be between 1s and 1m")
	}
	if math.IsNaN(o.Volume) || math.IsInf(o.Volume, 0) || o.Volume <= 0 || o.Volume > 1 {
		return fmt.Errorf("--volume must be greater than 0 and at most 1")
	}
	if math.IsNaN(o.MinRatio) || math.IsInf(o.MinRatio, 0) || o.MinRatio <= 1 {
		return fmt.Errorf("--min-ratio must be greater than 1")
	}
	if math.IsNaN(o.MinRise) || math.IsInf(o.MinRise, 0) || o.MinRise <= 0 {
		return fmt.Errorf("--min-rise must be greater than 0")
	}
	if o.MinSamples < 2 {
		return fmt.Errorf("at least two samples are required")
	}
	return nil
}

// Phase keeps raw telemetry for a single sound condition. FrequencyHz is zero
// during quiet windows and motion-only capture. Sample order is arrival order.
type Phase struct {
	Name        string            `json:"name"`
	FrequencyHz int               `json:"frequencyHz,omitempty"`
	Audio       []protocol.Audio  `json:"audio,omitempty"`
	Motion      []protocol.Motion `json:"motion,omitempty"`
}

type ToneResult struct {
	FrequencyHz int     `json:"frequencyHz"`
	BaselineRMS float64 `json:"baselineRms"`
	RMS         float64 `json:"rms"`
	Ratio       float64 `json:"ratio"`
	Rise        float64 `json:"rise"`
	Pass        bool    `json:"pass"`
	Reason      string  `json:"reason,omitempty"`
}

type AudioResult struct {
	Pass    bool         `json:"pass"`
	Reason  string       `json:"reason,omitempty"`
	Samples int          `json:"samples"`
	Tones   []ToneResult `json:"tones"`
}
