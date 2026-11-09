package diagnostics

import (
	"fmt"
	"math"

	"firewalker/cli/internal/protocol"
)

type MotionResult struct {
	Pass             bool    `json:"pass"`
	Reason           string  `json:"reason,omitempty"`
	Samples          int     `json:"samples"`
	MinTilt          float64 `json:"minTilt"`
	MaxTilt          float64 `json:"maxTilt"`
	MinAngleDeg      float64 `json:"minAngleDeg"`
	MaxAngleDeg      float64 `json:"maxAngleDeg"`
	MinAccel         float64 `json:"minAccel"`
	MaxAccel         float64 `json:"maxAccel"`
	MaxGyro          float64 `json:"maxGyro"`
	Stomps           int     `json:"stomps"`
	MovementDetected bool    `json:"movementDetected"`
}

// CheckMotion verifies fresh, plausible IMU telemetry. A stationary boot can pass
// the capture check; --require-movement additionally requires a visible change
// in tilt, rotation, or acceleration. It never recalibrates a mounted sensor.
func CheckMotion(status *protocol.Status, phases []Phase, options Options) MotionResult {
	result := MotionResult{}
	if status == nil || status.Sensor != "ok" {
		result.Reason = "motion sensor unavailable"
		return result
	}
	var accelerations []float64
	for _, phase := range phases {
		for _, sample := range phase.Motion {
			if !finite(sample.Tilt, sample.AngleDeg, sample.Accel, sample.AccelPeak, sample.Gyro, sample.Strength) || sample.Tilt < -1.001 || sample.Tilt > 1.001 || sample.Accel < 0 || sample.Accel > 1000 || sample.Gyro < 0 || sample.Gyro > 1000 {
				result.Reason = "invalid motion readings"
				return result
			}
			if result.Samples == 0 {
				result.MinTilt, result.MaxTilt = sample.Tilt, sample.Tilt
				result.MinAngleDeg, result.MaxAngleDeg = sample.AngleDeg, sample.AngleDeg
				result.MinAccel, result.MaxAccel = sample.Accel, sample.Accel
			}
			result.Samples++
			result.MinTilt, result.MaxTilt = math.Min(result.MinTilt, sample.Tilt), math.Max(result.MaxTilt, sample.Tilt)
			result.MinAngleDeg, result.MaxAngleDeg = math.Min(result.MinAngleDeg, sample.AngleDeg), math.Max(result.MaxAngleDeg, sample.AngleDeg)
			result.MinAccel, result.MaxAccel = math.Min(result.MinAccel, sample.Accel), math.Max(result.MaxAccel, sample.Accel)
			result.MaxGyro = math.Max(result.MaxGyro, sample.Gyro)
			if sample.Stomp {
				result.Stomps++
			}
			accelerations = append(accelerations, sample.Accel)
		}
	}
	if result.Samples < options.MinSamples {
		result.Reason = fmt.Sprintf("only %d motion samples; need %d", result.Samples, options.MinSamples)
		return result
	}
	if median(accelerations) < 0.1 {
		result.Reason = "motion capture reports no gravity or acceleration"
		return result
	}
	result.MovementDetected = result.MaxTilt-result.MinTilt >= 0.1 || result.MaxAngleDeg-result.MinAngleDeg >= 3 || result.MaxGyro >= 0.2 || result.MaxAccel-result.MinAccel >= 2 || result.Stomps > 0
	if options.RequireMovement && !result.MovementDetected {
		result.Reason = "no movement observed; tilt or move the boot during capture"
		return result
	}
	result.Pass = true
	return result
}

func finite(values ...float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}
