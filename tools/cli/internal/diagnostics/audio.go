package diagnostics

import (
	"fmt"
	"math"
	"slices"
)

// CheckAudio compares each tone with its preceding quiet window using raw RMS.
// Saved gain and the firmware's noise gate only affect the displayed 0..1 level,
// so they cannot turn a working microphone into a failed acoustic check here.
func CheckAudio(phases []Phase, options Options) AudioResult {
	result := AudioResult{Pass: true, Tones: []ToneResult{}}
	if problem := audioCaptureProblem(phases, options); problem != "" {
		result.Pass, result.Reason = false, problem
		return result
	}
	baseline := 0.0
	for _, phase := range phases {
		result.Samples += len(phase.Audio)
		values := make([]float64, 0, len(phase.Audio))
		for _, sample := range phase.Audio {
			values = append(values, sample.RMS)
		}
		rms := median(values)
		if phase.FrequencyHz == 0 {
			baseline = rms
			continue
		}
		tone := ToneResult{FrequencyHz: phase.FrequencyHz, BaselineRMS: baseline, RMS: rms, Ratio: rms / math.Max(baseline, 0.01), Rise: rms - baseline}
		tone.Pass = tone.Ratio >= options.MinRatio && tone.Rise >= options.MinRise
		if !tone.Pass {
			tone.Reason = fmt.Sprintf("no clear response: %.2fx background and %+.2f RMS; need %.2fx and +%.2f", tone.Ratio, tone.Rise, options.MinRatio, options.MinRise)
			result.Pass = false
			if result.Reason == "" {
				result.Reason = fmt.Sprintf("%d Hz: %s", tone.FrequencyHz, tone.Reason)
			}
		}
		result.Tones = append(result.Tones, tone)
	}
	if len(result.Tones) != 2 {
		result.Pass, result.Reason = false, "both 1000 Hz and 2000 Hz tone windows are required"
	}
	return result
}

// A loud number is not enough to pass: the ADC must stay available, its sample
// counter must advance, and neither rail may clip. Quiet windows need real data
// too; treating a missing baseline as zero would make every tone look enormous.
func audioCaptureProblem(phases []Phase, options Options) string {
	frequencies := []int{0, 1000, 0, 2000, 0}
	if len(phases) != len(frequencies) {
		return "quiet / 1000 Hz / quiet / 2000 Hz / quiet capture is incomplete"
	}
	var previous uint32
	havePrevious := false
	for n, phase := range phases {
		if phase.FrequencyHz != frequencies[n] {
			return "both 1000 Hz and 2000 Hz tone windows are required, with quiet windows between them"
		}
		if len(phase.Audio) < options.MinSamples {
			return fmt.Sprintf("%s: only %d microphone samples; need %d", phase.Name, len(phase.Audio), options.MinSamples)
		}
		for _, sample := range phase.Audio {
			if !sample.Ready {
				return phase.Name + ": microphone capture unavailable"
			}
			if sample.CaptureUs == 0 {
				return phase.Name + ": microphone sample timing is missing"
			}
			if math.IsNaN(sample.RMS) || math.IsInf(sample.RMS, 0) || sample.RMS < 0 || sample.RMS > 4095 || math.IsNaN(sample.Mean) || math.IsInf(sample.Mean, 0) || sample.Mean < 0 || sample.Mean > 4095 || sample.Low < 0 || sample.High > 4095 || sample.Low > sample.High {
				return phase.Name + ": invalid microphone ADC readings"
			}
			if sample.Low == 0 || sample.High == 4095 {
				return phase.Name + ": microphone ADC is clipping; reduce the sound level"
			}
			if havePrevious {
				// Unsigned subtraction accepts the normal uint32 wrap, but rejects
				// repeats and a counter that jumps backward after a reset.
				delta := sample.Blocks - previous
				if delta == 0 || delta > 1<<31 {
					return phase.Name + ": microphone capture is stale or restarted"
				}
			}
			previous, havePrevious = sample.Blocks, true
		}
	}
	return ""
}

func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	values = append([]float64(nil), values...)
	slices.Sort(values)
	mid := len(values) / 2
	if len(values)%2 == 1 {
		return values[mid]
	}
	return (values[mid-1] + values[mid]) / 2
}
