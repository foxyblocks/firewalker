// Package tui is the full-screen bench tool that `./cli` opens with no arguments: pick a
// boot, flash it, and watch what it says. Live control stays on the phone, so screens
// here only read a boot's state, apart from what's typed into the `:` console.
//
// Model is the Bubble Tea app. The main flow:
//
//   - Boards: discovery polls USB and the bar updates. autoSelect and cycleBoard hold the
//     never-guess rule, and nothing flashes or sends until a boot is picked.
//   - Link: the picked boot's serial port stays open through link.Follow. Every line
//     goes through handleLine, which logs it and updates the Boot screen and the bench
//     form from any status reply. Screens trust the latest status, not what was sent.
//     Human inactivity pauses Follow and releases the port; discovery and incoming
//     lines don't renew it. The next key reconnects without replaying an old command.
//   - Flashing (flashing.go): a confirm names the boot, the port closes, PlatformIO runs
//     with its output in the log, and then the port reopens and asks for status.
//
// Everything outside the process goes through Deps, so tests run the whole app on fake
// boards. form.go, logstore.go, and boardlist.go hold the pure logic, and view.go draws.
package tui

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/controlconfig"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
	"firewalker/cli/internal/theme"
)

const (
	discoverEvery = 1500 * time.Millisecond
	followRetry   = time.Second
	// statusTries covers the app starting up after a flash, which takes a couple of
	// seconds. Requests go out with doubling gaps, for about six seconds in all.
	statusTries      = 5
	statusFirstDelay = 400 * time.Millisecond
)

// Deps is how the TUI reaches outside itself. Run fills these in for real; tests hand in
// fake boards and a fake PlatformIO.
type Deps struct {
	RepoRoot          string
	Config            bench.StripLayout // include/config.h, the last-resort strip layout
	Discover          func() ([]boards.Board, error)
	Open              func(serial string) link.Opener
	RunJob            func(ctx context.Context, job flash.Job, onLine func(string)) error
	Cache             *boards.Cache
	Now               func() time.Time
	InactivityTimeout time.Duration
	Theme             *theme.Theme
}

// Run opens the TUI and blocks until it quits, which leaves the board running.
func Run(repoRoot string) error {
	idleTimeout, err := controlconfig.Read(repoRoot)
	if err != nil {
		return err
	}
	config, err := bench.ReadStripLayout(repoRoot)
	if err != nil {
		return err
	}
	cachePath, err := boards.DefaultCachePath()
	if err != nil {
		cachePath = ""
	}
	model := New(Deps{
		RepoRoot: repoRoot,
		Config:   config,
		Discover: boards.Discover,
		Open:     link.ForBoard,
		RunJob: func(ctx context.Context, job flash.Job, onLine func(string)) error {
			output := link.NewLineSplitter(onLine)
			defer output.Flush()
			return job.Run(ctx, os.Environ(), output, output)
		},
		Cache:             boards.OpenCache(cachePath),
		Now:               time.Now,
		InactivityTimeout: idleTimeout,
		Theme:             theme.New(os.Stdout),
	})
	_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
	model.Shutdown()
	return err
}

type screen int

const (
	screenBench screen = iota
	screenBuilds
	screenBoot
	screenLog
	screenCount
)

type logSize int

const (
	logSmall logSize = iota
	logHalf
	logHidden
	logSizeCount
)

// Messages from the app's background work. Each carries a generation so that a late
// message from a connection or a job that's since been replaced gets ignored.
type (
	tickMsg   struct{}
	boardsMsg struct {
		list []boards.Board
		err  error
	}
	linkEventMsg struct {
		gen   int
		event link.Event
		next  tea.Cmd
	}
	statusRetryMsg struct {
		gen, try int
	}
)

// Model is the whole app's state.
type Model struct {
	deps   Deps
	th     *theme.Theme
	ctx    context.Context
	cancel context.CancelFunc

	width, height int
	screen        screen
	logSize       logSize
	showHelp      bool
	log           logStore
	notice        string

	connected       []boards.Board
	rows            []boardRow
	selected        string // USB serial of the picked boot, or "" for none
	picking         bool   // the boot picker is open
	pickCursor      string // USB serial the picker\'s cursor is on
	lastDiscoverErr string

	gen          int
	followCancel context.CancelFunc
	followDone   chan struct{}
	conn         link.Transport
	status       *protocol.Status // the latest status from the picked boot, if any
	lastOpenErr  string
	lastActivity time.Time
	paused       bool

	form        *benchForm
	formEditing bool
	formInput   textinput.Model
	buildCursor int

	confirm *confirmation
	queue   []flashItem
	job     *runningJob
	jobGen  int
	stage   flash.Stage
	stageOf string // what the stage is about, such as "bench rainbow-pool on 3ED8"
	failure string // the reason the last flash failed, pinned above the log
	spin    spinner.Model

	console     console
	searching   bool
	searchInput textinput.Model
}

// New builds the app. Call Shutdown after it quits.
func New(deps Deps) *Model {
	ctx, cancel := context.WithCancel(context.Background())
	formInput := textinput.New()
	formInput.Prompt = ""
	searchInput := textinput.New()
	searchInput.Prompt = "/ "
	m := &Model{
		deps: deps, th: deps.Theme, ctx: ctx, cancel: cancel,
		lastActivity: deps.Now(),
		width:        80, height: 24,
		form:        newBenchForm(deps.Config),
		formInput:   formInput,
		searchInput: searchInput,
		console:     newConsole(),
		spin:        spinner.New(spinner.WithSpinner(spinner.Line)),
	}
	m.refreshRows()
	return m
}

// Init starts watching USB.
func (m *Model) Init() tea.Cmd { return m.discover() }

// Shutdown stops background work on the way out: it closes the port, which leaves the
// board running, and stops any flash still going rather than leave PlatformIO behind.
func (m *Model) Shutdown() {
	m.cancel()
	if m.job != nil {
		select {
		case <-m.job.done:
		case <-time.After(5 * time.Second):
		}
	}
	m.stopFollow()
}

func (m *Model) discover() tea.Cmd {
	return func() tea.Msg {
		list, err := m.deps.Discover()
		return boardsMsg{list, err}
	}
}

// Update routes one message. The app's background work all comes through here too, so
// its state only ever changes on this one goroutine.
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyMsg:
		return m, m.handleKey(msg)
	case tickMsg:
		return m, m.discover()
	case boardsMsg:
		return m, m.handleBoards(msg)
	case linkEventMsg:
		return m, m.handleLinkEvent(msg)
	case statusRetryMsg:
		return m, m.handleStatusRetry(msg)
	case jobLineMsg:
		return m, m.handleJobLine(msg)
	case jobDoneMsg:
		return m, m.handleJobDone(msg)
	case spinner.TickMsg:
		if m.job != nil {
			var cmd tea.Cmd
			m.spin, cmd = m.spin.Update(msg)
			return m, cmd
		}
	}
	return m, nil
}

// handleBoards takes a fresh USB list: it updates the bar, applies the lone-boot rule,
// and opens the picked boot's port if it just appeared. The next poll is scheduled here,
// so polls never pile up.
func (m *Model) handleBoards(msg boardsMsg) tea.Cmd {
	next := tea.Tick(discoverEvery, func(time.Time) tea.Msg { return tickMsg{} })
	// Check even when discovery fails, so a broken USB scan can't leave an abandoned
	// port held. Build/upload jobs finish first; their output isn't human activity.
	if !m.paused && m.deps.InactivityTimeout > 0 && !m.flashing() && m.deps.Now().Sub(m.lastActivity) >= m.deps.InactivityTimeout {
		m.paused = true
		m.stopFollow()
	}
	if msg.err != nil {
		// This repeats on every poll until it clears, so one line per reason.
		if text := msg.err.Error(); text != m.lastDiscoverErr {
			m.lastDiscoverErr = text
			m.addLog(theme.KindError, groupLogs, text)
		}
		return next
	}
	m.lastDiscoverErr = ""
	m.connected = msg.list
	m.refreshRows()

	if pick := autoSelect(m.selected, m.connected); pick != m.selected {
		return tea.Batch(next, m.selectBoard(pick))
	}
	if row, ok := m.selectedRow(); ok && row.OnUSB && m.followCancel == nil && !m.uploading() && !m.paused {
		return tea.Batch(next, m.startFollow())
	}
	return next
}

// refreshRows rebuilds the bar from what's on USB and what's remembered.
func (m *Model) refreshRows() {
	known := map[string]boards.Record{}
	for _, serial := range m.deps.Cache.Serials() {
		if record, ok := m.deps.Cache.Get(serial); ok {
			known[serial] = record
		}
	}
	m.rows = mergeBoards(m.connected, known)
}

func (m *Model) selectedRow() (boardRow, bool) {
	for _, row := range m.rows {
		if row.Serial == m.selected {
			return row, true
		}
	}
	return boardRow{}, false
}

// selectBoard moves to another boot. Its port opens and its layout fills the form, while
// the previous boot's port closes and it keeps running.
func (m *Model) selectBoard(serial string) tea.Cmd {
	m.stopFollow()
	m.selected = serial
	m.status = nil
	m.lastOpenErr = ""
	if !m.flashing() {
		m.stage, m.stageOf, m.failure = flash.StageIdle, "", ""
	}
	layout, note := m.layoutForForm()
	m.form.resetLayout(layout, note)
	if row, ok := m.selectedRow(); ok && row.OnUSB && !m.uploading() {
		return m.startFollow()
	}
	return nil
}

// layoutForForm picks the strip layout for the selected boot: the same choice, in the
// same order, as `./cli install rainbow-pool` makes.
func (m *Model) layoutForForm() (bench.StripLayout, string) {
	choices := bench.LayoutChoices{Config: m.deps.Config}
	name := ""
	if row, ok := m.selectedRow(); ok {
		name = row.name()
		if saved := row.Record.Layout; saved != nil {
			choices.Remembered = &bench.StripLayout{Pixels: saved.LEDs, Toe: saved.Toe, Heel: saved.Heel}
		}
	}
	if m.status != nil {
		if layout, ok := m.status.Layout(); ok {
			choices.Boot = &bench.StripLayout{Pixels: layout.LEDs, Toe: layout.Toe, Heel: layout.Heel}
		}
	}
	picked := bench.PickLayout(choices)
	switch picked.Source {
	case bench.SourceBoot:
		return picked.Layout, "saved on " + name
	case bench.SourceRemembered:
		return picked.Layout, "last known for " + name
	}
	return picked.Layout, "include/config.h"
}

// startFollow opens the picked boot's port and keeps it open through resets and replugs.
func (m *Model) startFollow() tea.Cmd {
	if m.paused {
		return nil
	}
	m.stopFollow()
	m.gen++
	gen := m.gen
	ctx, cancel := context.WithCancel(m.ctx)
	events := make(chan link.Event, 64)
	done := make(chan struct{})
	open := m.deps.Open(m.selected)
	go func() {
		defer close(done)
		defer close(events)
		link.Follow(ctx, open, followRetry, func(event link.Event) {
			select {
			case events <- event:
			case <-ctx.Done():
			}
		})
	}()
	m.followCancel, m.followDone = cancel, done
	return waitForLink(gen, events)
}

// stopFollow closes the port and waits briefly for it to let go, so that whatever comes
// next doesn't find it still busy.
func (m *Model) stopFollow() {
	if m.followCancel == nil {
		return
	}
	m.followCancel()
	select {
	case <-m.followDone:
	case <-time.After(time.Second):
	}
	m.followCancel, m.followDone = nil, nil
	m.conn = nil
	m.gen++
}

// waitForLink delivers the connection's next event. Handling an event is what asks for
// the one after it, so lines stay in order. Bubble Tea runs commands concurrently, so
// asking any earlier could let a later line overtake.
func waitForLink(gen int, events <-chan link.Event) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-events
		if !ok {
			return nil
		}
		return linkEventMsg{gen, event, waitForLink(gen, events)}
	}
}

func (m *Model) handleLinkEvent(msg linkEventMsg) tea.Cmd {
	// A connection that's been replaced stops here, which also stops reading from it.
	if msg.gen != m.gen {
		return nil
	}
	switch msg.event.Kind {
	case link.EventConnected:
		m.conn = msg.event.Link
		m.lastOpenErr = ""
		m.status = nil
		m.refreshFormLayout()
		m.addLog(theme.KindInfo, groupLogs, "attached to "+m.selectedName())
		_ = m.conn.Send("status")
		return tea.Batch(msg.next, m.scheduleStatusRetry(msg.gen, 1))
	case link.EventLine:
		m.handleLine(msg.event.Line)
	case link.EventDisconnected:
		m.conn, m.status = nil, nil
		m.refreshFormLayout()
		m.addLog(theme.KindInfo, groupLogs, "lost "+m.selectedName()+", waiting for it to come back")
	case link.EventOpenFailed:
		// This repeats every second until the port opens, so one line per reason.
		if text := msg.event.Err.Error(); text != m.lastOpenErr {
			m.lastOpenErr = text
			m.addLog(theme.KindError, groupLogs, "can't open "+m.selectedName()+": "+text)
		}
	}
	return msg.next
}

func (m *Model) scheduleStatusRetry(gen, try int) tea.Cmd {
	delay := statusFirstDelay << (try - 1)
	return tea.Tick(delay, func(time.Time) tea.Msg { return statusRetryMsg{gen, try} })
}

// handleStatusRetry asks again if the boot still hasn't answered. A bench build never
// will, and the extra requests do nothing to it.
func (m *Model) handleStatusRetry(msg statusRetryMsg) tea.Cmd {
	if msg.gen != m.gen || m.status != nil || m.conn == nil {
		return nil
	}
	_ = m.conn.Send("status")
	if msg.try+1 < statusTries {
		return m.scheduleStatusRetry(msg.gen, msg.try+1)
	}
	return nil
}

// handleLine logs one line from the boot. A status line is also the new truth for the
// Boot screen and the bench form, and gets remembered for when a bench build can't
// answer.
func (m *Model) handleLine(raw string) {
	line := protocol.Classify(raw)
	kind, text := theme.Describe(line)
	group := groupReplies
	switch line.Kind {
	case protocol.KindLog:
		group = groupLogs
	case protocol.KindMotion:
		group = groupMotion
	}
	m.addLog(kind, group, text)

	if line.Kind != protocol.KindStatus {
		return
	}
	m.status = line.Status
	m.rememberStatus(line.Status)
	m.refreshFormLayout()
}

// refreshFormLayout updates the form after what's known about the boot changes, so its
// note stays true: "saved on" only while the boot is actually reporting that layout, and
// "last known for" once it can't, such as with a bench build running.
func (m *Model) refreshFormLayout() {
	layout, note := m.layoutForForm()
	m.form.setLayout(layout, note)
}

// rememberStatus saves what's worth keeping from a status line. Lines can arrive four
// times a second while a phone drags a slider, so it only writes when something changed.
func (m *Model) rememberStatus(status *protocol.Status) {
	row, _ := m.selectedRow()
	layout, hasLayout := status.Layout()
	changed := status.ID != "" && status.ID != row.Record.ID
	if hasLayout {
		saved := row.Record.Layout
		changed = changed || saved == nil || saved.LEDs != layout.LEDs || saved.Toe != layout.Toe || saved.Heel != layout.Heel
	}
	if !changed {
		return
	}
	err := m.deps.Cache.Update(m.selected, func(r *boards.Record) {
		if status.ID != "" {
			r.ID = status.ID
		}
		if hasLayout {
			r.Layout = &boards.SavedLayout{LEDs: layout.LEDs, Toe: layout.Toe, Heel: layout.Heel}
		}
	})
	if err != nil {
		m.addLog(theme.KindError, groupLogs, "couldn't remember this boot: "+err.Error())
	}
	m.refreshRows()
}

func (m *Model) addLog(kind theme.Kind, group logGroup, text string) {
	m.log.add(m.deps.Now(), kind, group, text)
}

func (m *Model) selectedName() string {
	if row, ok := m.selectedRow(); ok {
		return row.name()
	}
	return m.selected
}

// answered says whether the picked boot's app has reported in on this connection.
func (m *Model) answered() bool { return m.status != nil }

// requireBoard checks that a boot is picked and reachable before an action, and explains
// what to do if not. This is where "nothing happens until one is picked" is enforced.
func (m *Model) requireBoard() (boardRow, bool) {
	row, ok := m.selectedRow()
	switch {
	case m.selected == "" || !ok:
		if len(m.connected) == 0 {
			m.notice = boards.ErrNoBoards.Error()
		} else {
			m.notice = "Pick a boot first: press p."
		}
		return boardRow{}, false
	case !row.OnUSB:
		m.notice = fmt.Sprintf("%s isn't on USB. Try a data cable or a port without a hub.", row.name())
		return boardRow{}, false
	}
	return row, true
}

// send writes one protocol line to the picked boot and logs it.
func (m *Model) send(line string) {
	row, ok := m.requireBoard()
	if !ok {
		return
	}
	if m.conn == nil {
		m.notice = row.name() + " isn't connected yet."
		return
	}
	m.addLog(theme.KindSent, groupReplies, line)
	if err := m.conn.Send(line); err != nil {
		m.addLog(theme.KindError, groupReplies, line+": "+err.Error())
	}
}
