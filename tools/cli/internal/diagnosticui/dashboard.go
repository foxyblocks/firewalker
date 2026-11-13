// Package diagnosticui shows live motion and microphone telemetry for every
// selected boot. diagnostics.Session owns each USB connection and restores its
// debug flag on exit or pause. Only the Bubble Tea event loop changes the
// displayed state; reader goroutines send messages with a connection generation
// so an old connection cannot replace readings after a deliberate reconnect.
package diagnosticui

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
	"firewalker/cli/internal/theme"
)

type reading struct {
	generation int
	boot       int
	session    *diagnostics.Session
	line       protocol.Line
	err        error
}
type tick time.Time

type bootView struct {
	boot                    boots.Boot
	session                 *diagnostics.Session
	status                  *protocol.Status
	motion                  *protocol.Motion
	audio                   *protocol.Audio
	motionAt, audioAt       time.Time
	tiltHistory, rmsHistory []float64
	stomps                  int
	state                   string
}

type model struct {
	ctx                  context.Context
	targets              []boots.Boot
	rows                 []bootView
	events               chan reading
	stop                 context.CancelFunc
	done                 chan struct{}
	generation           int
	viewport             viewport.Model
	width, height, focus int
	paused, showLogs     bool
	logs                 []string
	theme                *theme.Theme
	closeMu              sync.Mutex
	closeErrors          []error
}

// Run waits for all observers to close before returning, including restoration
// of debug after q, Ctrl-C, or Space. Paused readings remain visible with their age.
func Run(ctx context.Context, targets []boots.Boot, in io.Reader, out io.Writer) error {
	watchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	m := &model{ctx: watchCtx, targets: targets, events: make(chan reading, 512), width: 100, height: 32, theme: theme.New(out)}
	for _, b := range targets {
		m.rows = append(m.rows, bootView{boot: b, state: "connecting"})
	}
	m.viewport = viewport.New(100, 26)
	_, err := tea.NewProgram(m, tea.WithContext(ctx), tea.WithInput(in), tea.WithOutput(out), tea.WithAltScreen()).Run()
	cancel()
	if m.stop != nil {
		m.stop()
	}
	if m.done != nil {
		<-m.done
	}
	m.closeMu.Lock()
	defer m.closeMu.Unlock()
	return errors.Join(append([]error{err}, m.closeErrors...)...)
}

func (m *model) Init() tea.Cmd {
	m.start()
	return tea.Batch(m.wait(), nextTick())
}

func nextTick() tea.Cmd {
	return tea.Tick(250*time.Millisecond, func(at time.Time) tea.Msg { return tick(at) })
}

func (m *model) wait() tea.Cmd {
	return func() tea.Msg {
		select {
		case event := <-m.events:
			return event
		case <-m.ctx.Done():
			return nil
		}
	}
}

// start joins the previous generation before opening ports again. A fast pause /
// resume therefore cannot race a still-closing session for the same USB device.
func (m *model) start() {
	if m.stop != nil {
		m.stop()
	}
	previous := m.done
	ctx, cancel := context.WithCancel(m.ctx)
	m.stop = cancel
	m.done = make(chan struct{})
	done, generation := m.done, m.generation+1
	m.generation = generation
	for n := range m.rows {
		m.rows[n].session = nil
		m.rows[n].state = "connecting"
	}
	go func() {
		defer close(done)
		if previous != nil {
			select {
			case <-previous:
			case <-ctx.Done():
				return
			}
		}
		var group sync.WaitGroup
		for n, b := range m.targets {
			group.Add(1)
			go func() {
				defer group.Done()
				emit := func(event reading) {
					event.generation, event.boot = generation, n
					select {
					case m.events <- event:
					case <-ctx.Done():
					}
				}
				session, err := diagnostics.Connect(ctx, b.ID, link.ForBoard(b.Serial))
				if err != nil {
					emit(reading{err: err})
					return
				}
				defer func() {
					if err := session.Close(); err != nil {
						m.closeMu.Lock()
						m.closeErrors = append(m.closeErrors, fmt.Errorf("%s: %w", b.Name(), err))
						m.closeMu.Unlock()
					}
				}()
				emit(reading{session: session})
				for {
					line, err := session.Next(ctx)
					if ctx.Err() != nil {
						return
					}
					emit(reading{line: line, err: err})
					if err != nil {
						return
					}
				}
			}()
		}
		group.Wait()
	}()
}

func (m *model) pause() {
	m.paused = true
	m.generation++
	if m.stop != nil {
		m.stop()
	}
	for n := range m.rows {
		m.rows[n].session = nil
		m.rows[n].state = "paused"
	}
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var command tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.viewport.Width = max(20, msg.Width-2)
		m.viewport.Height = max(3, msg.Height-6)
	case tick:
		command = nextTick()
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "ctrl+c" || msg.String() == "esc" {
			return m, tea.Quit
		}
		if m.paused {
			m.paused = false
			m.start()
			break
		}
		switch msg.String() {
		case " ":
			m.pause()
		case "r":
			m.start()
		case "tab":
			if len(m.rows) > 0 {
				m.focus = (m.focus + 1) % len(m.rows)
				m.viewport.SetYOffset(m.focus * 9)
			}
		case "i":
			if len(m.rows) > 0 && m.rows[m.focus].session != nil {
				row := &m.rows[m.focus]
				if err := row.session.Send("identify"); err != nil {
					m.log(row.boot.Name() + ": " + err.Error())
				}
			}
		case "l":
			m.showLogs = !m.showLogs
		default:
			m.viewport, command = m.viewport.Update(msg)
		}
	case reading:
		command = m.wait()
		if msg.generation != m.generation || msg.boot < 0 || msg.boot >= len(m.rows) {
			break
		}
		row := &m.rows[msg.boot]
		if msg.err != nil {
			row.state = msg.err.Error()
			row.session = nil
			m.log(row.boot.Name() + ": " + row.state)
			break
		}
		if msg.session != nil {
			row.session, row.status, row.state = msg.session, msg.session.Status, "connected"
			break
		}
		switch msg.line.Kind {
		case protocol.KindMotion:
			row.motion, row.motionAt = msg.line.Motion, time.Now()
			row.tiltHistory = history(row.tiltHistory, msg.line.Motion.Tilt)
			if msg.line.Motion.Stomp {
				row.stomps++
			}
		case protocol.KindAudio:
			row.audio, row.audioAt = msg.line.Audio, time.Now()
			row.rmsHistory = history(row.rmsHistory, msg.line.Audio.RMS)
		case protocol.KindStatus:
			row.status = msg.line.Status
		default:
			_, text := theme.Describe(msg.line)
			m.log(row.boot.Name() + ": " + text)
		}
	}
	m.viewport.SetContent(m.content())
	return m, command
}

func (m *model) log(text string) {
	m.logs = append(m.logs, text)
	if len(m.logs) > 8 {
		m.logs = m.logs[len(m.logs)-8:]
	}
}

func history(values []float64, value float64) []float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return values
	}
	values = append(values, value)
	if len(values) > 40 {
		values = values[len(values)-40:]
	}
	return values
}

func (m *model) content() string {
	var out strings.Builder
	for n, row := range m.rows {
		name := row.boot.Name()
		if n == m.focus {
			name = m.theme.Selected.Render(" " + name + " ")
		} else {
			name = m.theme.Bold.Render(name)
		}
		proto, sensor := 0, "unknown"
		if row.status != nil {
			proto, sensor = row.status.Proto, row.status.Sensor
		}
		calibrated := row.status != nil && row.status.Calibrated
		fmt.Fprintf(&out, "%s  USB %s · protocol %d · %s · calibrated %t\n", name, row.boot.Serial, proto, row.state, calibrated)
		if motion := row.motion; motion != nil {
			fmt.Fprintf(&out, "  Motion  tilt %+.2f  angle %+.1f°  accel %.2f m/s²  gyro %.2f rad/s\n", motion.Tilt, motion.AngleDeg, motion.Accel, motion.Gyro)
			fmt.Fprintf(&out, "          %s  sensor %s · stomps %d · %s\n", spark(row.tiltHistory), sensor, row.stomps, age(row.motionAt))
		} else {
			fmt.Fprintln(&out, "  Motion  waiting for motion readings\n          ")
		}
		if audio := row.audio; audio != nil {
			fmt.Fprintf(&out, "  Audio   [%s] %3.0f%%  RMS %.2f  raw %d..%d  mean %.1f\n", bar(audio.Level, 20), audio.Level*100, audio.RMS, audio.Low, audio.High, audio.Mean)
			fmt.Fprintf(&out, "          %s\n", spark(row.rmsHistory))
			fmt.Fprintf(&out, "          ready %t · blocks %d · capture %d µs · %s\n", audio.Ready, audio.Blocks, audio.CaptureUs, age(row.audioAt))
		} else {
			fmt.Fprintln(&out, "  Audio   waiting for microphone readings\n          \n          ")
		}
		fmt.Fprintln(&out)
	}
	if m.showLogs {
		fmt.Fprintln(&out, m.theme.Bold.Render("Recent output"))
		for _, line := range m.logs {
			fmt.Fprintln(&out, line)
		}
	}
	return out.String()
}

func (m *model) View() string {
	state := "live"
	notice := fmt.Sprintf("Watching %d boots", len(m.rows))
	if m.paused {
		state = "paused"
		notice = "Press any key to reconnect; repeat your action once connected."
	}
	return m.theme.Title.Render("Firewalker diagnostics") + " · " + state + "\n" + m.theme.Dim.Render(notice) + "\n" + m.viewport.View() + "\n" + m.theme.Dim.Render("q quit · Space pause · r reconnect · Tab focus · i identify\nl logs · ↑/↓ scroll")
}

func age(at time.Time) string {
	elapsed := time.Since(at)
	if elapsed > 2*time.Second {
		return fmt.Sprintf("STALE — last report %.1fs ago", elapsed.Seconds())
	}
	return fmt.Sprintf("report %.1fs ago", elapsed.Seconds())
}

func bar(level float64, width int) string {
	if math.IsNaN(level) || math.IsInf(level, 0) {
		level = 0
	}
	filled := int(math.Round(math.Max(0, math.Min(1, level)) * float64(width)))
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}

func spark(values []float64) string {
	if len(values) == 0 {
		return "—"
	}
	low, high := values[0], values[0]
	for _, value := range values {
		low = math.Min(low, value)
		high = math.Max(high, value)
	}
	runes := []rune("▁▂▃▄▅▆▇█")
	var out strings.Builder
	for _, value := range values {
		index := 0
		if high > low {
			index = int(math.Round((value - low) / (high - low) * 7))
		}
		out.WriteRune(runes[max(0, min(7, index))])
	}
	fmt.Fprintf(&out, "  %.2f..%.2f", low, high)
	return out.String()
}
