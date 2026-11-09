package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/theme"
)

// flashItem is one PlatformIO run: a job, what it's called, and the command that does
// the same thing by hand, which the log shows so that anything here can be scripted.
type flashItem struct {
	Job     flash.Job
	Label   string // what goes on the board, as the tag will show it: "bench rainbow-pool"
	Target  string // the boot's name, or "" for a build with no upload
	Command string
}

// confirmation is the one question the TUI asks: flashing replaces what's on a boot, so
// it names the boot and what gets replaced, then waits for Enter. Nothing else asks.
type confirmation struct {
	Text  string
	Items []flashItem
}

type runningJob struct {
	item   flashItem
	cancel context.CancelFunc
	done   chan struct{}
}

type (
	jobLineMsg struct {
		gen  int
		line string
		next tea.Cmd
	}
	jobDoneMsg struct {
		gen int
		err error
	}
)

func (m *Model) flashing() bool { return m.job != nil || len(m.queue) > 0 }

// uploading says whether the port should stay closed. A job that only builds doesn't
// touch the board, so the log keeps streaming through it.
func (m *Model) uploading() bool {
	if m.job != nil && m.job.item.Job.Serial != "" {
		return true
	}
	for _, item := range m.queue {
		if item.Job.Serial != "" {
			return true
		}
	}
	return false
}

// busy refuses a second flash while one is running, since they'd fight over the probe.
func (m *Model) busy() bool {
	if m.flashing() {
		m.notice = "A flash is already running."
		return true
	}
	return false
}

func (m *Model) currentTag() string {
	row, _ := m.selectedRow()
	return tagFor(m.answered(), row.Record)
}

// replacing says what a flash removes, for the confirm.
func (m *Model) replacing() string {
	switch tag := m.currentTag(); tag {
	case "app":
		return "the app. Saved settings stay."
	case "unknown":
		return "what's running. Saved settings stay."
	default:
		return tag + ". Saved settings stay."
	}
}

// askFlashApp is `a`, from any screen.
func (m *Model) askFlashApp() {
	if m.busy() {
		return
	}
	row, ok := m.requireBoard()
	if !ok {
		return
	}
	m.confirm = &confirmation{
		Text:  fmt.Sprintf("Flash the app to %s? Saved settings stay.", row.name()),
		Items: []flashItem{m.appItem(row)},
	}
}

func (m *Model) appItem(row boardRow) flashItem {
	return flashItem{
		Job:     flash.Job{RepoRoot: m.deps.RepoRoot, Env: flash.AppEnv, Serial: row.Serial},
		Label:   flash.AppEnv,
		Target:  row.name(),
		Command: "./cli install --serial " + row.Serial,
	}
}

// askFlashBoth is `A`: every boot on USB in turn, after one confirm. The confirm names
// them all, so it's still not a guess.
func (m *Model) askFlashBoth() {
	if m.busy() {
		return
	}
	var items []flashItem
	var names []string
	for _, row := range m.rows {
		if row.OnUSB {
			items = append(items, m.appItem(row))
			names = append(names, row.name())
		}
	}
	if len(items) < 2 {
		m.notice = "A flashes two boots, and there aren't two on USB. Press a to flash this one."
		return
	}
	m.confirm = &confirmation{
		Text:  fmt.Sprintf("Flash the app to %s, one after the other? Saved settings stay.", strings.Join(names, " and ")),
		Items: items,
	}
}

// askFlashBuild flashes a whole build from the Builds screen. Build-only touches no board,
// so it needs no boot and no confirm.
func (m *Model) askFlashBuild(build flash.Build, buildOnly bool) tea.Cmd {
	if m.busy() {
		return nil
	}
	if buildOnly {
		item := flashItem{
			Job:     flash.Job{RepoRoot: m.deps.RepoRoot, Env: build.Env},
			Label:   build.Env,
			Command: "pio run -e " + build.Env,
		}
		return m.startItems([]flashItem{item})
	}
	row, ok := m.requireBoard()
	if !ok {
		return nil
	}
	if build.Env == flash.AppEnv {
		m.askFlashApp()
		return nil
	}
	m.confirm = &confirmation{
		Text: fmt.Sprintf("Flash %s to %s? It replaces %s", build.Env, row.name(), m.replacing()),
		Items: []flashItem{{
			Job:     flash.Job{RepoRoot: m.deps.RepoRoot, Env: build.Env, Serial: row.Serial},
			Label:   build.Env,
			Target:  row.name(),
			Command: fmt.Sprintf("pio run -e %s -t upload --upload-port %s", build.Env, row.Serial),
		}},
	}
	return nil
}

// askFlashBench flashes what's in the form. A form that doesn't validate shows its reason
// instead of a confirm, so an impossible test can't be flashed.
func (m *Model) askFlashBench(buildOnly bool) tea.Cmd {
	if m.busy() {
		return nil
	}
	o, c, err := m.form.build(m.previewSerial())
	if err != nil {
		m.notice = err.Error()
		return nil
	}
	label := "bench " + c.Name
	item := flashItem{
		Job:     flash.Job{RepoRoot: m.deps.RepoRoot, Env: "bench", SrcFlags: bench.BuildFlags(o, c)},
		Label:   label,
		Command: m.form.preview(m.previewSerial()),
	}
	if buildOnly {
		item.Command += " --build-only"
		return m.startItems([]flashItem{item})
	}
	row, ok := m.requireBoard()
	if !ok {
		return nil
	}
	item.Job.Serial, item.Target = row.Serial, row.name()
	m.confirm = &confirmation{
		Text:  fmt.Sprintf("Flash %s to %s? It replaces %s", label, row.name(), m.replacing()),
		Items: []flashItem{item},
	}
	return nil
}

// previewSerial always names the picked boot. Canonical install commands without
// an identifier open the selector, so a pasted bench command needs the serial to
// run headlessly even when only one board is connected.
func (m *Model) previewSerial() string {
	return m.selected
}

func (m *Model) startItems(items []flashItem) tea.Cmd {
	m.queue = items
	return m.startNext()
}

// startNext runs the next queued item. An upload closes the port first, because the TUI
// owns it and the flash resets the board anyway.
func (m *Model) startNext() tea.Cmd {
	item := m.queue[0]
	m.queue = m.queue[1:]
	if item.Job.Serial != "" {
		m.stopFollow()
		m.status = nil
	}
	m.stage, m.failure = flash.StageBuilding, ""
	m.stageOf = item.Label
	if item.Target != "" {
		m.stageOf += " for " + item.Target
	}
	m.log.toBottom()
	m.addLog(theme.KindInfo, groupBuild, "building "+m.stageOf)
	m.addLog(theme.KindInfo, groupBuild, item.Command)

	m.jobGen++
	gen := m.jobGen
	ctx, cancel := context.WithCancel(m.ctx)
	events := make(chan tea.Msg, 256)
	done := make(chan struct{})
	m.job = &runningJob{item: item, cancel: cancel, done: done}
	deliver := func(msg tea.Msg) {
		select {
		case events <- msg:
		case <-m.ctx.Done():
		}
	}
	go func() {
		defer close(done)
		defer cancel()
		defer close(events)
		err := m.deps.RunJob(ctx, item.Job, func(line string) { deliver(jobLineMsg{gen: gen, line: line}) })
		deliver(jobDoneMsg{gen, err})
	}()
	return tea.Batch(waitForJob(events), m.spin.Tick)
}

// waitForJob delivers a running job's next message. As with waitForLink, handling a line
// is what asks for the next one, so build output stays in order.
func waitForJob(events <-chan tea.Msg) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-events
		if !ok {
			return nil
		}
		if line, isLine := msg.(jobLineMsg); isLine {
			line.next = waitForJob(events)
			return line
		}
		return msg
	}
}

func (m *Model) handleJobLine(msg jobLineMsg) tea.Cmd {
	if msg.gen == m.jobGen {
		if stage, ok := flash.StageFromOutput(msg.line); ok {
			m.stage = stage
		}
		kind := theme.KindBuild
		if flash.IsErrorLine(msg.line) {
			kind = theme.KindError
			m.failure = msg.line
		}
		m.addLog(kind, groupBuild, msg.line)
	}
	return msg.next
}

// handleJobDone finishes one flash. Only the exit code decides how it went. A failure
// stops anything still queued, because the next boot shouldn't get a build that just
// failed, and either way the port reopens and asks for status.
func (m *Model) handleJobDone(msg jobDoneMsg) tea.Cmd {
	if msg.gen != m.jobGen || m.job == nil {
		return nil
	}
	item := m.job.item
	m.job = nil

	if msg.err != nil {
		m.queue = nil
		m.stage = flash.StageFailed
		if m.failure == "" {
			m.failure = msg.err.Error()
		}
		m.addLog(theme.KindError, groupBuild, msg.err.Error())
		return m.resumeLink()
	}
	m.failure = ""
	if item.Job.Serial != "" {
		m.rememberFlash(item)
		m.addLog(theme.KindOK, groupBuild, "uploaded "+item.Label+" to "+item.Target)
		m.stage, m.stageOf = flash.StageRunning, item.Label+" on "+item.Target
	} else {
		m.addLog(theme.KindOK, groupBuild, "built "+item.Label)
		m.stage, m.stageOf = flash.StageIdle, ""
	}
	if len(m.queue) > 0 {
		return m.startNext()
	}
	return m.resumeLink()
}

func (m *Model) rememberFlash(item flashItem) {
	err := m.deps.Cache.Update(item.Job.Serial, func(r *boards.Record) {
		r.LastFlashed = item.Label
		r.FlashedAt = time.Now()
	})
	if err != nil {
		m.addLog(theme.KindError, groupLogs, "couldn't remember this flash: "+err.Error())
	}
	m.refreshRows()
}

// resumeLink reattaches after a flash, unless the port is already open or the boot is
// gone. A build-only job never closed the port.
func (m *Model) resumeLink() tea.Cmd {
	if row, ok := m.selectedRow(); ok && row.OnUSB && m.followCancel == nil {
		return m.startFollow()
	}
	return nil
}
