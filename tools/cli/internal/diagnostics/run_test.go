package diagnostics_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/link"
)

func TestRunReportsEveryBootAndRestoresTheirDebugSettings(t *testing.T) {
	ports := map[string]*link.Fake{}
	stop := make(chan struct{})
	defer close(stop)
	for _, id := range []string{"GOOD", "BAD"} {
		port := link.NewFake()
		sensor := "ok"
		if id == "BAD" {
			sensor = "unavailable"
		}
		port.Script("status", fmt.Sprintf(`{"t":"status","id":%q,"proto":5,"sensor":%q,"debug":false}`, id, sensor))
		port.Script("debug on", `{"t":"ack","cmd":"debug","ok":true}`)
		port.Script("debug off", `{"t":"ack","cmd":"debug","ok":true}`)
		ports[id] = port
		go func() {
			ticker := time.NewTicker(20 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-ticker.C:
					if !port.Closed() && slices.Contains(port.Sent(), "debug on") {
						port.Push(`{"t":"motion","accel":9.81,"gyro":0.01,"tilt":0.1,"angleDeg":2}`)
					}
				}
			}
		}()
	}
	options := diagnostics.DefaultOptions()
	options.Kind, options.Duration = diagnostics.Motion, time.Second
	report, err := diagnostics.Run(context.Background(), []boots.Boot{{ID: "GOOD", Serial: "one"}, {ID: "BAD", Serial: "two"}}, options, diagnostics.Dependencies{
		Open: func(b boots.Boot) (link.Transport, error) { return ports[b.ID], nil },
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if report.Pass || len(report.Results) != 2 || !report.Results[0].Pass || report.Results[1].Pass {
		t.Fatalf("report = %+v", report)
	}
	for id, port := range ports {
		if !port.Closed() || !slices.Contains(port.Sent(), "debug off") {
			t.Errorf("%s closed=%t commands=%v", id, port.Closed(), port.Sent())
		}
	}
}

type unavailablePlayer struct{ calls int }

func (p *unavailablePlayer) Name() string { return "unavailable speaker" }
func (p *unavailablePlayer) Play(context.Context, int, time.Duration, float64) error {
	p.calls++
	return errors.New("speaker unavailable")
}

func TestAudioPlaybackFailureIsAnErrorAndStillRestoresTheBoot(t *testing.T) {
	port := link.NewFake()
	port.Script("status", `{"t":"status","id":"3EB5","proto":5,"sensor":"ok","debug":false}`)
	port.Script("debug on", `{"t":"ack","cmd":"debug","ok":true}`)
	port.Script("debug off", `{"t":"ack","cmd":"debug","ok":true}`)
	player := &unavailablePlayer{}
	options := diagnostics.DefaultOptions()
	options.Kind, options.Duration = diagnostics.Audio, time.Second
	report, err := diagnostics.Run(context.Background(), []boots.Boot{{ID: "3EB5", Serial: "test"}}, options, diagnostics.Dependencies{
		Open: func(boots.Boot) (link.Transport, error) { return port, nil }, Player: player,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "speaker unavailable") || report.Pass || player.calls != 1 {
		t.Fatalf("report=%+v, error=%v, playback calls=%d", report, err, player.calls)
	}
	if !port.Closed() || !slices.Contains(port.Sent(), "debug off") {
		t.Fatalf("USB wasn't restored: %v", port.Sent())
	}
}

func TestCanceledRunKeepsEveryRequestedBootInTheReport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	options := diagnostics.DefaultOptions()
	options.Kind = diagnostics.Motion
	report, err := diagnostics.Run(ctx, []boots.Boot{{ID: "AAAA", Serial: "one"}, {ID: "BBBB", Serial: "two"}}, options, diagnostics.Dependencies{
		Open: func(boots.Boot) (link.Transport, error) { t.Fatal("canceled run opened USB"); return nil, nil },
	}, nil)
	if !errors.Is(err, context.Canceled) || report.Pass || len(report.Results) != 2 || report.Results[0].ID != "AAAA" || report.Results[1].ID != "BBBB" {
		t.Fatalf("report=%+v, error=%v", report, err)
	}
}
