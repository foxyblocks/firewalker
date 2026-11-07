package diagnostics_test

import (
	"testing"

	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/protocol"
)

func TestMotionChecksCaptureSeparatelyFromPhysicalMovement(t *testing.T) {
	phase := diagnostics.Phase{Name: "motion"}
	for range 6 {
		phase.Motion = append(phase.Motion, protocol.Motion{Accel: 9.81, AccelPeak: 9.85})
	}
	options := diagnostics.DefaultOptions()
	status := &protocol.Status{Sensor: "ok"}
	if result := diagnostics.CheckMotion(status, []diagnostics.Phase{phase}, options); !result.Pass || result.MovementDetected {
		t.Fatalf("stationary capture = %+v", result)
	}
	options.RequireMovement = true
	if result := diagnostics.CheckMotion(status, []diagnostics.Phase{phase}, options); result.Pass {
		t.Fatalf("stationary boot must not pass a movement check: %+v", result)
	}
	phase.Motion[3].Tilt, phase.Motion[3].AngleDeg = 0.5, 15
	if result := diagnostics.CheckMotion(status, []diagnostics.Phase{phase}, options); !result.Pass || !result.MovementDetected {
		t.Fatalf("moving boot = %+v", result)
	}
}
