package tui

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/theme"
)

const (
	rightStatus = `{"t":"status","proto":2,"id":"3ED8","pattern":"flow","lit":"flow","brightness":24,"maxBrightness":64,"sensor":"ok","tilt":0.12,"calibrated":true,"neutralDeg":1.56,"heelDeg":-18.40,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":3,"debug":false,"ble":true,"leds":94,"maxLeds":160,"toe":86,"heel":48,"preview":false}`
	leftStatus  = `{"t":"status","proto":2,"id":"3EB5","pattern":"fire-trail","lit":"fire-trail","brightness":16,"maxBrightness":64,"sensor":"ok","tilt":0.00,"calibrated":false,"neutralDeg":0.00,"heelDeg":null,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":false,"leds":107,"maxLeds":160,"toe":72,"heel":19,"preview":false}`
	oldStatus   = `{"t":"status","proto":1,"id":"3ED8","pattern":"flow","lit":"flow","brightness":24,"maxBrightness":64,"sensor":"unavailable","tilt":0.00,"calibrated":false,"neutralDeg":0.00,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":false}`
)

// fakeJob is a PlatformIO run a test controls: it reports its job, prints lines, and
// finishes when told to.
type fakeJob struct {
	job    flash.Job
	onLine func(string)
	finish chan error
}

// harness runs the real Model the way Bubble Tea would: commands run concurrently and
// their messages come back through Update on one goroutine. Boards and PlatformIO are
// fakes, and no terminal is involved, so the view is plain text.
type harness struct {
	t        *testing.T
	m        *Model
	messages chan tea.Msg
	quit     bool

	mu    sync.Mutex
	links map[string][]*link.Fake // every connection opened to each serial, in order
	jobs  chan *fakeJob
	reply map[string]string // what each serial answers `status` with; "" stays silent
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		t:        t,
		messages: make(chan tea.Msg, 1024),
		links:    map[string][]*link.Fake{},
		jobs:     make(chan *fakeJob, 8),
		reply:    map[string]string{},
	}
	h.m = New(Deps{
		RepoRoot: "/repo",
		Config:   testConfigLayout,
		Discover: func() ([]boards.Board, error) { return nil, nil },
		Open: func(serial string) link.Opener {
			return func() (link.Transport, error) {
				h.mu.Lock()
				defer h.mu.Unlock()
				fake := link.NewFake()
				if reply := h.reply[serial]; reply != "" {
					fake.Script("status", reply)
				}
				h.links[serial] = append(h.links[serial], fake)
				return fake, nil
			}
		},
		RunJob: func(ctx context.Context, job flash.Job, onLine func(string)) error {
			fake := &fakeJob{job: job, onLine: onLine, finish: make(chan error, 1)}
			h.jobs <- fake
			select {
			case err := <-fake.finish:
				return err
			case <-ctx.Done():
				return ctx.Err()
			}
		},
		Cache: boards.OpenCache(filepath.Join(t.TempDir(), "boards.json")),
		Now:   time.Now,
		Theme: theme.New(&bytes.Buffer{}),
	})
	t.Cleanup(h.m.Shutdown)
	return h
}

func (h *harness) run(cmd tea.Cmd) {
	if cmd != nil {
		go func() { h.messages <- cmd() }()
	}
}

func (h *harness) apply(msg tea.Msg) {
	switch msg := msg.(type) {
	case nil:
	case tea.BatchMsg:
		for _, cmd := range msg {
			h.run(cmd)
		}
	case tea.QuitMsg:
		h.quit = true
	default:
		_, cmd := h.m.Update(msg)
		h.run(cmd)
	}
}

// settle applies messages until the app goes quiet. Timers like the poll and the spinner
// run longer than this, so they don't keep it busy.
func (h *harness) settle() {
	for {
		select {
		case msg := <-h.messages:
			h.apply(msg)
		case <-time.After(25 * time.Millisecond):
			return
		}
	}
}

func (h *harness) until(what string, done func() bool) {
	h.t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			h.t.Fatalf("timed out waiting for %s\n%s", what, h.m.View())
		}
		h.settle()
	}
}

func (h *harness) key(keys ...string) {
	for _, key := range keys {
		var msg tea.KeyMsg
		switch key {
		case "tab":
			msg = tea.KeyMsg{Type: tea.KeyTab}
		case "shift+tab":
			msg = tea.KeyMsg{Type: tea.KeyShiftTab}
		case "enter":
			msg = tea.KeyMsg{Type: tea.KeyEnter}
		case "esc":
			msg = tea.KeyMsg{Type: tea.KeyEsc}
		case "up":
			msg = tea.KeyMsg{Type: tea.KeyUp}
		case "down":
			msg = tea.KeyMsg{Type: tea.KeyDown}
		case "left":
			msg = tea.KeyMsg{Type: tea.KeyLeft}
		case "right":
			msg = tea.KeyMsg{Type: tea.KeyRight}
		case "ctrl+c":
			msg = tea.KeyMsg{Type: tea.KeyCtrlC}
		case "ctrl+j":
			msg = tea.KeyMsg{Type: tea.KeyCtrlJ}
		case "ctrl+k":
			msg = tea.KeyMsg{Type: tea.KeyCtrlK}
		case " ":
			msg = tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(key)}
		}
		h.apply(msg)
		h.settle()
	}
}

func (h *harness) typed(text string) {
	for _, r := range text {
		h.key(string(r))
	}
}

func (h *harness) plugIn(list ...boards.Board) {
	h.apply(boardsMsg{list: list})
	h.settle()
}

func (h *harness) view() string { return h.m.View() }

func (h *harness) wantView(texts ...string) {
	h.t.Helper()
	view := h.view()
	for _, text := range texts {
		if !strings.Contains(view, text) {
			h.t.Errorf("view is missing %q:\n%s", text, view)
		}
	}
}

func (h *harness) wantNotInView(texts ...string) {
	h.t.Helper()
	view := h.view()
	for _, text := range texts {
		if strings.Contains(view, text) {
			h.t.Errorf("view shouldn't have %q:\n%s", text, view)
		}
	}
}

// current returns the newest connection to a board.
func (h *harness) current(serial string) *link.Fake {
	h.t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	opened := h.links[serial]
	if len(opened) == 0 {
		h.t.Fatalf("nothing ever opened %s", serial)
	}
	return opened[len(opened)-1]
}

func (h *harness) opened(serial string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.links[serial])
}

func (h *harness) nextJob() *fakeJob {
	h.t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case job := <-h.jobs:
			return job
		case msg := <-h.messages:
			h.apply(msg)
		case <-deadline:
			h.t.Fatalf("no job started\n%s", h.view())
		}
	}
}

func (h *harness) noJob() {
	h.t.Helper()
	h.settle()
	select {
	case job := <-h.jobs:
		h.t.Fatalf("expected no flash, got %+v", job.job)
	default:
	}
}

// app opens with one app-running boot plugged in and answering.
func appRunning(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t)
	h.reply[right.Serial] = rightStatus
	h.plugIn(right)
	h.until("the boot to answer", func() bool { return h.m.status != nil })
	return h
}

func TestInactivityReleasesThePortUntilAKeyWakesIt(t *testing.T) {
	h := appRunning(t)
	now := time.Now()
	h.m.deps.Now = func() time.Time { return now }
	h.m.deps.InactivityTimeout = 2 * time.Minute
	h.key("3")
	first := h.current(right.Serial)
	now = now.Add(119 * time.Second)
	h.plugIn(right)
	if first.Closed() {
		t.Fatal("released before two minutes")
	}
	// Received output and USB discovery must not extend human inactivity.
	first.Push(rightStatus)
	h.settle()
	now = now.Add(time.Second)
	h.plugIn(right)
	if !first.Closed() {
		t.Fatal("idle client still holds the port")
	}
	h.wantView("Connection paused while idle")
	h.plugIn(right)
	if h.opened(right.Serial) != 1 {
		t.Fatal("discovery reclaimed a paused port")
	}
	h.key("enter")
	h.until("wake to attach", func() bool { return h.opened(right.Serial) == 2 && h.m.conn != nil })
	h.noJob() // The wake key must not also confirm a build or flash.
}

func TestALoneBootIsPickedAndAskedForStatus(t *testing.T) {
	h := appRunning(t)
	h.wantView("● 3ED8 · app · 94 LEDs")
	if sent := h.current(right.Serial).Sent(); sent[0] != "status" {
		t.Fatalf("sent %v", sent)
	}
	// The bench form starts from what the boot has saved, toe after heel and all.
	h.wantView("94", "saved on 3ED8", "./cli install flow --brightness 16 --serial "+right.Serial)
	if h.m.form.values[fieldToe] != "86" || h.m.form.values[fieldHeel] != "48" {
		t.Fatalf("form = %+v", h.m.form.values)
	}
}

func TestPickingTheSameBootKeepsItsConnection(t *testing.T) {
	h := appRunning(t)
	before := h.current(right.Serial)
	h.key("p", "enter")
	if h.current(right.Serial) != before || before.Closed() {
		t.Fatal("picking the boot already picked shouldn't reconnect")
	}
	if h.m.status == nil {
		t.Fatal("picking the boot already picked shouldn't forget its status")
	}
}

// The picker shows enough to tell boots apart, and only offers ones it can actually reach.
func TestPickerListsEachBootAndSkipsOnesNotOnUSB(t *testing.T) {
	h := newHarness(t)
	for serial, id := range map[string]string{right.Serial: "3ED8", left.Serial: "3EB5"} {
		if err := h.m.deps.Cache.Update(serial, func(r *boards.Record) { r.ID = id }); err != nil {
			t.Fatal(err)
		}
	}
	gone := "12345678"
	if err := h.m.deps.Cache.Update(gone, func(r *boards.Record) { r.ID = "3ED1" }); err != nil {
		t.Fatal(err)
	}
	if err := h.m.deps.Cache.Update(left.Serial, func(r *boards.Record) { r.LastFlashed = "bench flow" }); err != nil {
		t.Fatal(err)
	}
	h.plugIn(right, left)

	h.key("p")
	h.wantView("Pick a boot", "3ED8", right.Serial, "unknown", "3EB5", left.Serial, "bench flow", "3ED1", gone, "not on USB", "enter pick")

	// The rows sort by serial, with the one that's gone first, and the cursor skips it.
	h.key("enter")
	if h.m.selected != right.Serial {
		t.Fatalf("picked %q, want the first boot on USB", h.m.selected)
	}
	h.key("p", "up", "up", "enter")
	if h.m.selected == gone {
		t.Fatal("picked a boot that isn't on USB")
	}
}

func TestPickerWithNoBootsExplainsInstead(t *testing.T) {
	h := newHarness(t)
	h.plugIn()
	h.key("p")
	if h.m.picking {
		t.Fatal("nothing to pick from")
	}
	h.wantView("No MG24 on USB")
}

// A letter pressed while the picker is open belongs to the picker, so it can't start a
// flash behind it.
func TestPickerHoldsTheKeyboardWhileOpen(t *testing.T) {
	h := appRunning(t)
	h.key("p", "a", "q", "3")
	if h.m.confirm != nil || h.quit || h.m.screen != screenBench {
		t.Fatalf("a key got past the picker: confirm=%v quit=%v screen=%v", h.m.confirm, h.quit, h.m.screen)
	}
	h.key("p")
	if h.m.picking {
		t.Fatal("p should close the picker again")
	}
}

// keysFromTerminal feeds raw bytes through Bubble Tea's real input parser, the way a
// terminal delivers them, and returns the key names the app would see.
func keysFromTerminal(t *testing.T, data string, count int) []string {
	t.Helper()
	recorder := &keyRecorder{want: count}
	program := tea.NewProgram(recorder, tea.WithInput(strings.NewReader(data)), tea.WithOutput(io.Discard), tea.WithoutSignalHandler())
	done := make(chan error, 1)
	go func() {
		_, err := program.Run()
		done <- err
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		program.Kill()
		t.Fatalf("got only %v", recorder.keys)
	}
	return recorder.keys
}

type keyRecorder struct {
	want int
	keys []string
}

func (r *keyRecorder) Init() tea.Cmd { return nil }
func (r *keyRecorder) View() string  { return "" }
func (r *keyRecorder) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := msg.(tea.KeyMsg); ok {
		r.keys = append(r.keys, key.String())
		if len(r.keys) == r.want {
			return r, tea.Quit
		}
	}
	return r, nil
}

// This one matters: Enter on the bench form leads to a flash, so a scroll key must never
// look like Enter. Terminals send Enter as a carriage return and ctrl+j as a line feed.
func TestCtrlJStaysDistinctFromEnter(t *testing.T) {
	got := keysFromTerminal(t, "\r\n\x0b", 3)
	if want := []string{"enter", "ctrl+j", "ctrl+k"}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestScrollKeysDontReachTheFlashConfirm(t *testing.T) {
	h := appRunning(t)
	h.key("ctrl+j", "ctrl+k")
	if h.m.confirm != nil {
		t.Fatal("a scroll key opened the flash confirm")
	}
	h.noJob()
}

// Tab is how to get around, so it moves between screens, and it never touches the boots.
func TestTabMovesBetweenScreensAndLeavesTheBootAlone(t *testing.T) {
	h := newHarness(t)
	h.reply[right.Serial], h.reply[left.Serial] = rightStatus, leftStatus
	h.plugIn(right, left)
	if h.m.selected != "" {
		t.Fatalf("selected = %q", h.m.selected)
	}
	for _, want := range []screen{screenBuilds, screenBoot, screenLog, screenBench} {
		h.key("tab")
		if h.m.screen != want {
			t.Fatalf("screen = %v, want %v", h.m.screen, want)
		}
	}
	h.key("shift+tab")
	if h.m.screen != screenLog {
		t.Fatalf("shift+tab went to %v", h.m.screen)
	}
	if h.m.selected != "" || h.opened(right.Serial)+h.opened(left.Serial) != 0 {
		t.Fatalf("tab picked a boot: selected = %q", h.m.selected)
	}
	h.wantView("Press p to pick a boot.")
}

// The tabs read the same way all along the row: a number, then a plain name.
func TestScreenNamesAreNumberThenPlainText(t *testing.T) {
	h := appRunning(t)
	for _, key := range []string{"1", "2", "3", "5"} {
		h.key(key)
		h.wantView("1 Bench test", "2 Builds", "3 Boot", "5 Log")
		h.wantNotInView("DEBUG", "FLASH", "LOG")
	}
}

// Every key hint has to be readable on an ordinary 80-column terminal.
func TestKeyHintsFitAnOrdinaryTerminal(t *testing.T) {
	h := appRunning(t)
	_, cmd := h.m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	h.run(cmd)
	for _, key := range []string{"1", "2", "3", "5"} {
		h.key(key)
		lines := strings.Split(h.view(), "\n")
		hints := lines[len(lines)-1]
		if !strings.Contains(hints, "tab screen") || !strings.Contains(hints, "p boot") || !strings.HasSuffix(strings.TrimRight(hints, " "), "q quit") {
			t.Errorf("screen %s hints: %q", key, hints)
		}
	}
}

func TestARepeatingDiscoveryErrorIsLoggedOnce(t *testing.T) {
	h := newHarness(t)
	for range 3 {
		h.apply(boardsMsg{err: errors.New("no USB today")})
	}
	h.settle()
	count := 0
	for _, entry := range h.m.log.entries {
		if entry.Text == "no USB today" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("logged %d times", count)
	}
}

func TestPageKeysScrollTheFullLogScreen(t *testing.T) {
	h := appRunning(t)
	_, cmd := h.m.Update(tea.WindowSizeMsg{Width: 80, Height: 12})
	h.run(cmd)
	for i := range 30 {
		h.current(right.Serial).Push(fmt.Sprintf("line-%02d", i))
	}
	h.settle()
	h.key("5")
	h.wantView("line-29")
	h.key("ctrl+k")
	h.wantNotInView("line-29")
	h.key("ctrl+j")
	h.wantView("line-29")
	// Page keys do the same, for keyboards that have them.
	h.apply(tea.KeyMsg{Type: tea.KeyPgUp})
	h.settle()
	h.wantNotInView("line-29")
	h.apply(tea.KeyMsg{Type: tea.KeyPgDown})
	h.settle()
	h.wantView("line-29")
}

func TestScrollKeysWorkOnTheSmallPaneToo(t *testing.T) {
	h := appRunning(t)
	for i := range 30 {
		h.current(right.Serial).Push(fmt.Sprintf("line-%02d", i))
	}
	h.settle()
	h.wantView("line-29")
	h.key("ctrl+k")
	h.wantNotInView("line-29")
	h.key("ctrl+j")
	h.wantView("line-29")
}

func TestNoBootSuggestsACable(t *testing.T) {
	h := newHarness(t)
	h.plugIn()
	h.wantView("No MG24 on USB. Try a data cable or a port without a hub.")
	h.key("a")
	if h.m.confirm != nil {
		t.Fatal("nothing to flash")
	}
}

// The heart of it: with two boots and no choice made, nothing flashes and nothing sends.
func TestTwoBootsWaitForAChoice(t *testing.T) {
	h := newHarness(t)
	h.reply[right.Serial], h.reply[left.Serial] = rightStatus, leftStatus
	h.plugIn(right, left)
	h.wantView("Press p to pick a boot.")
	if h.opened(right.Serial)+h.opened(left.Serial) != 0 {
		t.Fatal("no port should open before a boot is picked")
	}

	h.key("a")
	if h.m.confirm != nil {
		t.Fatal("a shouldn't offer to flash with no boot picked")
	}
	h.wantView("Pick a boot first: press p.")
	h.key("enter")
	if h.m.confirm != nil {
		t.Fatal("enter shouldn't offer to flash with no boot picked")
	}
	h.key(":")
	h.typed("identify")
	h.key("enter")
	h.wantView("Pick a boot first: press p.")
	h.noJob()

	// Opening the picker and backing out still picks nothing.
	h.key("p", "esc")
	if h.m.selected != "" || h.opened(right.Serial)+h.opened(left.Serial) != 0 {
		t.Fatalf("cancelling the picker picked %q", h.m.selected)
	}

	// Enter picks one, and then the other, and only the picked one's port is ever open.
	h.key("p", "enter")
	first := h.m.selected
	h.until("the first boot to answer", func() bool { return h.m.status != nil })
	h.key("p", "down", "enter")
	second := h.m.selected
	if first == second {
		t.Fatalf("the picker stayed on %s", first)
	}
	if !h.current(first).Closed() {
		t.Fatal("switching boots should close the previous port")
	}
	h.until("the second boot to answer", func() bool { return h.m.status != nil })
	h.key("p", "up", "enter")
	if h.m.selected != first {
		t.Fatalf("up went to %s", h.m.selected)
	}
	h.until("the boot to answer again", func() bool { return h.m.status != nil })
	if h.m.form.values[fieldLEDs] != "94" && h.m.form.values[fieldLEDs] != "107" {
		t.Fatalf("form = %+v", h.m.form.values)
	}
}

func TestSwitchingBootsRefillsTheLayout(t *testing.T) {
	h := newHarness(t)
	h.reply[right.Serial], h.reply[left.Serial] = rightStatus, leftStatus
	h.plugIn(right, left)
	h.key("p", "enter")
	h.until("3ED8", func() bool { return h.m.status != nil && h.m.status.ID == "3ED8" })
	if h.m.form.values[fieldLEDs] != "94" {
		t.Fatalf("leds = %q", h.m.form.values[fieldLEDs])
	}
	h.key("p", "down", "enter")
	h.until("3EB5", func() bool { return h.m.status != nil && h.m.status.ID == "3EB5" })
	if h.m.form.values[fieldLEDs] != "107" || h.m.form.values[fieldToe] != "72" || h.m.form.values[fieldHeel] != "19" {
		t.Fatalf("form = %+v", h.m.form.values)
	}
	// With two boots on USB, a pasted command has to name one.
	h.wantView("--serial " + left.Serial)
}

func TestFlashingTheAppAsksFirstAndReconnectsAfter(t *testing.T) {
	h := appRunning(t)
	before := h.current(right.Serial)

	h.key("a")
	h.wantView("Flash the app to 3ED8? Saved settings stay.")
	h.noJob()
	h.key("esc")
	if h.m.confirm != nil {
		t.Fatal("esc should cancel")
	}
	h.noJob()

	h.key("a", "enter")
	job := h.nextJob()
	if job.job.Env != flash.AppEnv || job.job.Serial != right.Serial {
		t.Fatalf("job = %+v", job.job)
	}
	if !before.Closed() {
		t.Fatal("the port should close before an upload")
	}
	h.settle()
	h.wantView("building final_app for 3ED8", "./cli install --serial "+right.Serial)

	job.onLine("Compiling .pio/build/final_app/src/main.cpp.o")
	job.onLine("mg24 upload: targeting probe " + right.Serial)
	h.until("the upload stage", func() bool { return h.m.stage == flash.StageUploading })
	h.wantView("uploading final_app for 3ED8", "Compiling .pio/build/final_app/src/main.cpp.o")

	job.finish <- nil
	h.until("the boot to answer again", func() bool { return h.m.status != nil && h.m.stage == flash.StageRunning })
	if after := h.current(right.Serial); after == before {
		t.Fatal("expected a fresh connection after the flash")
	} else if sent := after.Sent(); sent[0] != "status" {
		t.Fatalf("sent %v", sent)
	}
	h.wantView("✓ running final_app on 3ED8", "● 3ED8 · app")
	if record, _ := h.m.deps.Cache.Get(right.Serial); record.LastFlashed != flash.AppEnv {
		t.Fatalf("record = %+v", record)
	}
}

func TestAFailedFlashKeepsTheReasonOnScreen(t *testing.T) {
	h := appRunning(t)
	h.key("a", "enter")
	job := h.nextJob()
	job.onLine("mg24 upload: no MG24 matches 'NOPE'. Connected: none")
	job.onLine("========== [FAILED] Took 1.2 seconds ==========")
	job.onLine("*** [upload] Error 1")
	job.finish <- errors.New("pio run failed: exit status 1")
	h.until("the failed stage", func() bool { return h.m.stage == flash.StageFailed })
	h.wantView("✗ failed final_app for 3ED8", "*** [upload] Error 1")

	// The old firmware is still there, and it gets asked again.
	h.until("the link to come back", func() bool { return h.m.status != nil })
	h.wantView("✗ failed final_app for 3ED8")
	if record, _ := h.m.deps.Cache.Get(right.Serial); record.LastFlashed == flash.AppEnv {
		t.Fatal("a failed flash shouldn't count as flashed")
	}
}

func TestBothBootsFlashInTurnAfterOneConfirm(t *testing.T) {
	h := newHarness(t)
	h.plugIn(right, left)
	h.key("A")
	h.wantView("Flash the app to", right.Serial, left.Serial, "one after the other")
	h.key("enter")

	first := h.nextJob()
	h.noJob()
	first.finish <- nil
	second := h.nextJob()
	if first.job.Serial == second.job.Serial {
		t.Fatalf("both jobs went to %s", first.job.Serial)
	}
	for _, job := range []*fakeJob{first, second} {
		if job.job.Env != flash.AppEnv {
			t.Fatalf("job = %+v", job.job)
		}
	}
	second.finish <- nil
	h.until("both to finish", func() bool { return !h.m.flashing() })
	for _, b := range []boards.Board{right, left} {
		if record, _ := h.m.deps.Cache.Get(b.Serial); record.LastFlashed != flash.AppEnv {
			t.Errorf("%s = %+v", b.Serial, record)
		}
	}
}

func TestAFailureStopsTheSecondBoot(t *testing.T) {
	h := newHarness(t)
	h.plugIn(right, left)
	h.key("A", "enter")
	first := h.nextJob()
	first.finish <- errors.New("pio run failed: exit status 1")
	h.until("the failure", func() bool { return h.m.stage == flash.StageFailed })
	h.noJob()
}

func TestBothBootsNeedsTwoBoots(t *testing.T) {
	h := appRunning(t)
	h.key("A")
	if h.m.confirm != nil {
		t.Fatal("A with one boot shouldn't offer to flash")
	}
	h.wantView("Press a to flash this one")
}

func TestBenchFlashUsesTheBootsLayoutAndStaysAttached(t *testing.T) {
	h := appRunning(t)
	h.key("enter")
	h.wantView("Flash bench flow to 3ED8? It replaces the app. Saved settings stay.", "enter flash · esc cancel")
	h.key("enter")
	job := h.nextJob()
	if job.job.Env != "bench" || job.job.Serial != right.Serial {
		t.Fatalf("job = %+v", job.job)
	}
	for _, want := range []string{"-DFIREWALKER_LED_COUNT=94", "-DFIREWALKER_STRIP_TOE_INDEX=86", "-DFIREWALKER_STRIP_HEEL_INDEX=48", "-DBENCH_TEST=0"} {
		if !slices.Contains(job.job.SrcFlags, want) {
			t.Errorf("missing %s in %v", want, job.job.SrcFlags)
		}
	}

	// A bench build doesn't answer status, but its logs still come through, and its tag
	// comes from what was flashed. The layout stays known for the next test.
	h.reply[right.Serial] = ""
	job.finish <- nil
	h.until("a new connection", func() bool { return h.m.conn != nil && h.m.stage == flash.StageRunning })
	h.current(right.Serial).Push("[firewalker] stomp -> trail (2 active)")
	h.until("the firmware's log", func() bool { return strings.Contains(h.view(), "stomp -> trail") })
	h.wantView("● 3ED8 · bench flow · 94 LEDs", "✓ running bench flow on 3ED8")
	// The boot can't report a layout now, so the form says it's going from memory.
	if h.m.form.values[fieldLEDs] != "94" || h.m.form.layoutNote() != "last known for 3ED8" {
		t.Fatalf("form = %+v note = %q", h.m.form.values, h.m.form.layoutNote())
	}

	// `a` from here offers the way back.
	h.key("a")
	h.wantView("Flash the app to 3ED8? Saved settings stay.")
}

func TestABuildOnlyRunNeedsNoBootAndNoConfirm(t *testing.T) {
	h := newHarness(t)
	h.plugIn()
	h.key("b")
	job := h.nextJob()
	if job.job.Serial != "" {
		t.Fatalf("a build-only run must not upload: %+v", job.job)
	}
	job.finish <- nil
	h.until("the build to finish", func() bool { return !h.m.flashing() })
	h.wantView("built bench flow")
}

func TestAnImpossibleFormCantBeFlashed(t *testing.T) {
	h := appRunning(t)
	h.m.form.values[fieldToe] = "48"
	h.wantView("✗ --toe and --heel must be different pixels")
	h.key("enter")
	if h.m.confirm != nil {
		t.Fatal("an invalid form shouldn't reach the confirm")
	}
	h.noJob()
}

func TestTypingInAFieldDoesntTriggerShortcuts(t *testing.T) {
	h := appRunning(t)
	h.key("down", "down", "down") // Test, Input, Tilt, Stomp every
	if got := h.m.form.focused(); got != fieldStomp {
		t.Fatalf("focused = %v", got)
	}
	h.key("e")
	h.typed("a2sq1")
	if h.m.confirm != nil || h.quit || h.m.screen != screenBench {
		t.Fatalf("a typed key acted as a shortcut: confirm=%v quit=%v screen=%v", h.m.confirm, h.quit, h.m.screen)
	}
	h.key("esc")
	if h.m.form.values[fieldStomp] != "0s" {
		t.Fatalf("esc should cancel: %q", h.m.form.values[fieldStomp])
	}
	h.key("e")
	h.m.formInput.SetValue("")
	h.typed("2s")
	h.key("enter")
	if h.m.form.values[fieldStomp] != "2s" {
		t.Fatalf("stomp = %q", h.m.form.values[fieldStomp])
	}
	if h.m.confirm != nil {
		t.Fatal("enter in a field should keep the value, not flash")
	}
	h.wantView("./cli install flow --stomp-every 2s --brightness 16")
}

func TestBootScreenShowsTheStatusAndTheKeysSendCommands(t *testing.T) {
	h := appRunning(t)
	h.key("3")
	h.wantView("flow   brightness 24 / 64", "94 LEDs   toe 86   heel 48", "tilt +0.12", "heel -18.4°", "toe —", "saved ✓", "phone connected")
	h.key("i", "r", "d")
	sent := h.current(right.Serial).Sent()
	for _, want := range []string{"identify", "status", "debug on"} {
		if !slices.Contains(sent, want) {
			t.Errorf("sent %v, missing %q", sent, want)
		}
	}
}

func TestBootScreenOnABenchBuildOffersTheApp(t *testing.T) {
	h := newHarness(t)
	if err := h.m.deps.Cache.Update(right.Serial, func(r *boards.Record) {
		r.ID, r.LastFlashed = "3ED8", "bench flow"
		r.Layout = &boards.SavedLayout{LEDs: 94, Toe: 86, Heel: 48}
	}); err != nil {
		t.Fatal(err)
	}
	h.plugIn(right)
	h.key("3")
	h.wantView("isn't answering status", "bench flow", "94 LEDs   toe 86   heel 48", "a flash the app")
	if h.m.form.layoutNote() != "last known for 3ED8" {
		t.Fatalf("note = %q", h.m.form.layoutNote())
	}
}

// Older firmware still answers, it just can't describe its strip.
func TestOlderFirmwareIsFlaggedAndStillWorks(t *testing.T) {
	h := newHarness(t)
	h.reply[right.Serial] = oldStatus
	h.plugIn(right)
	h.until("the boot to answer", func() bool { return h.m.status != nil })
	h.wantView("3ED8 is on old firmware (proto 1). Press a to update it.", "● 3ED8 · app")
	if h.m.form.values[fieldLEDs] != "160" || h.m.form.layoutNote() != "include/config.h" {
		t.Fatalf("form = %+v note = %q", h.m.form.values, h.m.form.layoutNote())
	}
	h.key("3")
	h.wantView("proto 1 doesn't report a layout", "unavailable")
}

func TestUnpluggedBootStaysListedAndBlocksFlashing(t *testing.T) {
	h := appRunning(t)
	h.plugIn()
	h.wantView("3ED8 · not on USB")
	if h.m.selected != right.Serial {
		t.Fatalf("selected = %q", h.m.selected)
	}
	h.key("a")
	if h.m.confirm != nil {
		t.Fatal("a boot that's gone can't be flashed")
	}
	h.wantView("3ED8 isn't on USB")
}

// A different boot appearing can't take over while the picked one is unplugged.
func TestAnotherBootDoesntTakeOverAnUnpluggedChoice(t *testing.T) {
	h := appRunning(t)
	h.plugIn(left)
	if h.m.selected != right.Serial {
		t.Fatalf("selected = %q", h.m.selected)
	}
}

func TestConsoleSendsAnyLineWithHistoryAndCompletion(t *testing.T) {
	h := appRunning(t)
	h.key(":")
	h.typed("strip p")
	h.key("tab")
	if got := h.m.console.input.Value(); got != "strip preview on" {
		t.Fatalf("completion = %q", got)
	}
	h.key("tab")
	if got := h.m.console.input.Value(); got != "strip preview off" {
		t.Fatalf("second completion = %q", got)
	}
	h.key("tab")
	if got := h.m.console.input.Value(); got != "strip preview on" {
		t.Fatalf("wrapped completion = %q", got)
	}
	h.key("enter")
	if !slices.Contains(h.current(right.Serial).Sent(), "strip preview on") {
		t.Fatalf("sent %v", h.current(right.Serial).Sent())
	}
	h.wantView("→  strip preview on")

	h.key(":", "up")
	if got := h.m.console.input.Value(); got != "strip preview on" {
		t.Fatalf("history = %q", got)
	}
	h.key("down")
	if got := h.m.console.input.Value(); got != "" {
		t.Fatalf("back to the draft = %q", got)
	}
	// Shortcut letters typed here are just text.
	h.typed("aq")
	if h.m.confirm != nil || h.quit {
		t.Fatal("console text acted as a shortcut")
	}
	h.key("esc")
	if h.m.console.open {
		t.Fatal("esc should close the console")
	}
}

// Setting the strip layout belongs to the phone for now, so no ordinary action sends it.
func TestOnlyTheConsoleSendsStripCommands(t *testing.T) {
	h := appRunning(t)
	h.key("3", "r", "i", "d", "d", "1", "down", "right", "left", "2", "down", "up", "5", "r", "1")
	for _, line := range h.current(right.Serial).Sent() {
		if strings.HasPrefix(line, "strip") {
			t.Fatalf("sent %q", line)
		}
	}
}

func TestLogSizeCyclesAndTheFullScreenFilters(t *testing.T) {
	h := appRunning(t)
	fake := h.current(right.Serial)
	fake.Push("[firewalker] stomp -> trail (2 active)")
	fake.Push(`{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":false,"strength":0.00}`)
	h.settle()
	h.wantView("─ log", "stomp -> trail", "tilt +0.05")

	h.key("l")
	h.wantView("─ log")
	h.key("l")
	h.wantNotInView("─ log", "stomp -> trail")
	h.key("l")
	h.wantView("─ log")

	h.key("5")
	h.wantView("Log", "▣ m motion", "stomp -> trail", "tilt +0.05")
	h.key("m")
	h.wantView("□ m motion", "stomp -> trail")
	h.wantNotInView("tilt +0.05")
	h.key("m", "f")
	h.wantNotInView("stomp -> trail")
	h.wantView("tilt +0.05")
	h.key("f", "/")
	h.typed("stomp")
	h.key("enter")
	h.wantView("stomp -> trail")
	h.wantNotInView("tilt +0.05")
	h.key("/", "esc")
	h.wantView("tilt +0.05")

	h.key(" ")
	h.wantView("paused")
	fake.Push("[firewalker] after the pause")
	h.settle()
	h.wantNotInView("after the pause")
	h.key(" ")
	h.wantView("after the pause")
}

func TestQuittingSendsNothingAndWaitsOutAFlash(t *testing.T) {
	h := appRunning(t)
	before := len(h.current(right.Serial).Sent())
	h.key("a", "enter")
	job := h.nextJob()
	h.key("q")
	if h.quit {
		t.Fatal("q during a flash should explain instead of quitting")
	}
	h.wantView("A flash is running")
	job.finish <- nil
	h.until("the flash to finish", func() bool { return !h.m.flashing() })

	h.until("the boot to answer", func() bool { return h.m.status != nil })
	last := h.current(right.Serial)
	sentBefore := len(last.Sent())
	h.key("q")
	h.until("the quit", func() bool { return h.quit })
	if got := len(last.Sent()); got != sentBefore {
		t.Fatalf("quitting sent %v", last.Sent()[sentBefore:])
	}
	if before == 0 {
		t.Fatal("expected the first connection to have asked for status")
	}
}

func TestCtrlCStopsARunningFlash(t *testing.T) {
	h := appRunning(t)
	h.key("a", "enter")
	h.nextJob()
	running := h.m.job
	h.key("ctrl+c")
	h.until("the quit", func() bool { return h.quit })
	h.m.Shutdown()
	select {
	case <-running.done:
	default:
		t.Fatal("Shutdown should leave no flash running")
	}
}

func TestAPortThatWontOpenIsExplainedOnce(t *testing.T) {
	h := newHarness(t)
	h.m.deps.Open = func(string) link.Opener {
		return func() (link.Transport, error) { return nil, errors.New("Serial port busy") }
	}
	h.plugIn(right)
	h.until("the error", func() bool { return strings.Contains(h.view(), "Serial port busy") })
	count := 0
	for _, entry := range h.m.log.entries {
		if strings.Contains(entry.Text, "Serial port busy") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("logged %d times", count)
	}
	h.wantView("● "+right.Serial, "unknown")
}

func TestFrameFitsTheWindow(t *testing.T) {
	h := appRunning(t)
	_, cmd := h.m.Update(tea.WindowSizeMsg{Width: 60, Height: 14})
	h.run(cmd)
	for _, key := range []string{"1", "2", "3", "5", "1"} {
		h.key(key)
		lines := strings.Split(h.view(), "\n")
		if len(lines) > 14 {
			t.Fatalf("screen %s drew %d lines on a 14-line window:\n%s", key, len(lines), h.view())
		}
		if !strings.Contains(lines[len(lines)-1], "q quit") && !strings.Contains(lines[len(lines)-1], "…") {
			t.Fatalf("screen %s lost its key hints:\n%s", key, h.view())
		}
		for _, line := range lines {
			if width := len([]rune(line)); width > 60 {
				t.Fatalf("screen %s drew a %d-wide line: %q", key, width, line)
			}
		}
	}
}
