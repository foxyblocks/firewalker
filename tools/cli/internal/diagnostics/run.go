package diagnostics

import (
	"context"
	"fmt"
	"sync"
	"time"

	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
)

// Dependencies are the two things outside the process: USB connections and host
// sound playback. The command line uses real adapters; tests provide transports
// and a player that can reproduce disconnections and acoustic conditions.
type Dependencies struct {
	Open   func(boots.Boot) (link.Transport, error)
	Player TonePlayer
}

type Result struct {
	ID       string        `json:"id"`
	Serial   string        `json:"serial"`
	Protocol int           `json:"protocol"`
	Pass     bool          `json:"pass"`
	Error    string        `json:"error,omitempty"`
	Audio    *AudioResult  `json:"audio,omitempty"`
	Motion   *MotionResult `json:"motion,omitempty"`
	Phases   []Phase       `json:"-"`
}

func (r *Result) addError(err error) {
	if err == nil {
		return
	}
	if r.Error == "" {
		r.Error = err.Error()
	} else {
		r.Error += "; " + err.Error()
	}
}

type Report struct {
	Diagnostic    string   `json:"diagnostic"`
	Pass          bool     `json:"pass"`
	WindowSeconds float64  `json:"windowSeconds"`
	Player        string   `json:"player,omitempty"`
	MinRatio      float64  `json:"minRatio,omitempty"`
	MinRise       float64  `json:"minRise,omitempty"`
	Volume        float64  `json:"volume,omitempty"`
	MinSamples    int      `json:"minSamples"`
	Results       []Result `json:"results"`
}

type sampleEvent struct {
	boot int
	at   time.Time
	line protocol.Line
	err  error
}

// Run observes every selected boot in the same measurement windows. A failed
// boot remains in the report while the others finish. It always joins its reader
// goroutines and restores temporary debug streaming before returning results.
func Run(ctx context.Context, targets []boots.Boot, options Options, deps Dependencies, progress func(string)) (report Report, runErr error) {
	report = Report{Diagnostic: options.Kind, WindowSeconds: options.Duration.Seconds(), MinSamples: options.MinSamples, Results: make([]Result, len(targets))}
	for n, b := range targets {
		report.Results[n] = Result{ID: b.Name(), Serial: b.Serial}
	}
	if err := options.Validate(); err != nil {
		return report, err
	}
	if len(targets) == 0 {
		return report, fmt.Errorf("select at least one boot")
	}
	if options.Kind != Motion {
		report.MinRatio, report.MinRise, report.Volume = options.MinRatio, options.MinRise, options.Volume
		if deps.Player == nil {
			player, err := SystemPlayer()
			if err != nil {
				return report, err
			}
			deps.Player = player
		}
		report.Player = deps.Player.Name()
	}
	if deps.Open == nil {
		deps.Open = func(b boots.Boot) (link.Transport, error) { return link.ForBoard(b.Serial)() }
	}
	sessions := make([]*Session, len(targets))
	statuses := make([]*protocol.Status, len(targets))
	events := make(chan sampleEvent, 512)
	streamCtx, stop := context.WithCancel(ctx)
	var readers sync.WaitGroup
	defer func() {
		stop()
		readers.Wait()
		report.Pass = runErr == nil
		for n, session := range sessions {
			result := &report.Results[n]
			if session != nil {
				result.addError(session.Close())
			}
			if runErr != nil {
				result.addError(runErr)
			}
			if options.Kind != Motion {
				checked := CheckAudio(result.Phases, options)
				result.Audio = &checked
			}
			if options.Kind != Audio {
				checked := CheckMotion(statuses[n], result.Phases, options)
				result.Motion = &checked
			}
			result.Pass = result.Error == "" && (result.Audio == nil || result.Audio.Pass) && (result.Motion == nil || result.Motion.Pass)
			report.Pass = report.Pass && result.Pass
		}
	}()
	for n, b := range targets {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		session, err := Connect(ctx, b.ID, func() (link.Transport, error) { return deps.Open(b) })
		if err != nil {
			report.Results[n].addError(err)
			continue
		}
		sessions[n], statuses[n] = session, session.Status
		report.Results[n].Protocol = session.Status.Proto
		if session.Status.ID != "" {
			report.Results[n].ID = session.Status.ID
		}
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				line, err := session.Next(streamCtx)
				if streamCtx.Err() != nil {
					return
				}
				select {
				case events <- sampleEvent{boot: n, at: time.Now(), line: line, err: err}:
				case <-streamCtx.Done():
					return
				}
				if err != nil {
					return
				}
			}
		}()
	}
	connected := false
	for _, session := range sessions {
		connected = connected || session != nil
	}
	if !connected {
		return report, nil
	}
	plan := []Phase{{Name: "motion"}}
	if options.Kind != Motion {
		plan = []Phase{{Name: "quiet-before"}, {Name: "tone-1000Hz", FrequencyHz: 1000}, {Name: "quiet-between"}, {Name: "tone-2000Hz", FrequencyHz: 2000}, {Name: "quiet-after"}}
	}
	for _, phase := range plan {
		if progress != nil {
			progress(fmt.Sprintf("%s — %s", phase.Name, options.Duration))
		}
		playCtx, stopPlayback := context.WithCancel(ctx)
		var played chan error
		var finished chan struct{}
		if phase.FrequencyHz != 0 {
			played, finished = make(chan error, 1), make(chan struct{})
			go func() {
				defer close(finished)
				played <- deps.Player.Play(playCtx, phase.FrequencyHz, options.Duration, options.Volume)
			}()
		}
		err := capturePhase(ctx, &report, events, statuses, phase, options.Duration, played)
		stopPlayback()
		if finished != nil {
			<-finished
		}
		if err != nil {
			return report, err
		}
	}
	return report, nil
}

// capturePhase uses one shared clock for all boots. Tone playback may have host
// startup latency, so tone windows keep only the final requested duration before
// playback completes; startup silence cannot dilute the microphone measurement.
func capturePhase(ctx context.Context, report *Report, events <-chan sampleEvent, statuses []*protocol.Status, phase Phase, duration time.Duration, playback <-chan error) error {
	started := time.Now()
	var collected []sampleEvent
	timer := time.NewTimer(duration)
	defer timer.Stop()
	var deadline <-chan time.Time = timer.C
	if playback != nil {
		timer.Reset(duration + 10*time.Second)
	}
	var phaseErr error
loop:
	for {
		select {
		case <-ctx.Done():
			phaseErr = ctx.Err()
			break loop
		case err := <-playback:
			phaseErr = err
			break loop
		case <-deadline:
			if playback != nil {
				phaseErr = fmt.Errorf("tone playback timed out")
			}
			break loop
		case event := <-events:
			if event.err != nil {
				report.Results[event.boot].addError(event.err)
				continue
			}
			if event.at.Before(started) {
				continue
			}
			if event.line.Kind == protocol.KindStatus {
				statuses[event.boot] = event.line.Status
			}
			collected = append(collected, event)
		}
	}
	finished := time.Now()
	cutoff := started
	if playback != nil {
		cutoff = finished.Add(-duration)
	}
	for n := range report.Results {
		current := Phase{Name: phase.Name, FrequencyHz: phase.FrequencyHz}
		for _, event := range collected {
			if event.boot != n || event.at.Before(cutoff) {
				continue
			}
			switch event.line.Kind {
			case protocol.KindAudio:
				current.Audio = append(current.Audio, *event.line.Audio)
			case protocol.KindMotion:
				current.Motion = append(current.Motion, *event.line.Motion)
			}
		}
		report.Results[n].Phases = append(report.Results[n].Phases, current)
	}
	return phaseErr
}
