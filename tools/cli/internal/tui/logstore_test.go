package tui

import (
	"slices"
	"testing"
	"time"

	"firewalker/cli/internal/theme"
)

func texts(entries []logEntry) []string {
	var out []string
	for _, e := range entries {
		out = append(out, e.Text)
	}
	return out
}

func filled(lines ...string) *logStore {
	store := &logStore{}
	for _, line := range lines {
		store.add(time.Time{}, theme.KindFirmware, groupLogs, line)
	}
	return store
}

func TestWindowShowsTheNewestLinesThatFit(t *testing.T) {
	store := filled("a", "b", "c", "d")
	if got := texts(store.window(2)); !slices.Equal(got, []string{"c", "d"}) {
		t.Fatalf("got %v", got)
	}
}

func TestFiltersHideAGroupAndSearchNarrowsIt(t *testing.T) {
	store := filled("stomp -> trail", "tilt ok")
	store.add(time.Time{}, theme.KindMotion, groupMotion, "tilt +0.05")
	store.add(time.Time{}, theme.KindBuild, groupBuild, "Compiling main.cpp")

	store.toggle(groupMotion)
	if got := texts(store.window(10)); !slices.Equal(got, []string{"stomp -> trail", "tilt ok", "Compiling main.cpp"}) {
		t.Fatalf("hiding motion: got %v", got)
	}
	store.toggle(groupMotion)
	store.search = "TILT"
	if got := texts(store.window(10)); !slices.Equal(got, []string{"tilt ok", "tilt +0.05"}) {
		t.Fatalf("searching: got %v", got)
	}
}

// Pausing is for reading a line that's scrolling away, so new lines keep being recorded
// but the view holds still until it resumes.
func TestPauseHoldsTheViewWhileLinesKeepArriving(t *testing.T) {
	store := filled("a", "b")
	store.togglePause()
	store.add(time.Time{}, theme.KindFirmware, groupLogs, "c")
	if got := texts(store.window(10)); !slices.Equal(got, []string{"a", "b"}) {
		t.Fatalf("paused: got %v", got)
	}
	store.togglePause()
	if got := texts(store.window(10)); !slices.Equal(got, []string{"a", "b", "c"}) {
		t.Fatalf("resumed: got %v", got)
	}
}

func TestScrollingBackStaysPutAsNewLinesArrive(t *testing.T) {
	store := filled("a", "b", "c", "d")
	store.scroll(1, 2)
	if got := texts(store.window(2)); !slices.Equal(got, []string{"b", "c"}) {
		t.Fatalf("scrolled: got %v", got)
	}
	store.add(time.Time{}, theme.KindFirmware, groupLogs, "e")
	if got := texts(store.window(2)); !slices.Equal(got, []string{"b", "c"}) {
		t.Fatalf("after a new line: got %v", got)
	}
	store.toBottom()
	if got := texts(store.window(2)); !slices.Equal(got, []string{"d", "e"}) {
		t.Fatalf("back at the bottom: got %v", got)
	}
	// Scrolling can't go past either end.
	store.scroll(100, 2)
	if got := texts(store.window(2)); !slices.Equal(got, []string{"a", "b"}) {
		t.Fatalf("at the top: got %v", got)
	}
	store.scroll(-100, 2)
	if got := texts(store.window(2)); !slices.Equal(got, []string{"d", "e"}) {
		t.Fatalf("at the bottom: got %v", got)
	}
}

func TestLogDropsTheOldestLinesPastItsCap(t *testing.T) {
	store := &logStore{}
	for i := 0; i < maxLogEntries+10; i++ {
		store.add(time.Time{}, theme.KindFirmware, groupLogs, "line")
	}
	if len(store.entries) != maxLogEntries {
		t.Fatalf("kept %d lines", len(store.entries))
	}
}
