package tui

import (
	"testing"

	"firewalker/cli/internal/boards"
)

var (
	left  = boards.Board{Port: "/dev/cu.left", Serial: "FBC116E9"}
	right = boards.Board{Port: "/dev/cu.right", Serial: "99C817E5"}
)

func TestMergeShowsAKnownBoardThatIsMissingFromUSB(t *testing.T) {
	known := map[string]boards.Record{"FBC116E9": {ID: "3EB5"}, "99C817E5": {ID: "3ED8"}}
	rows := mergeBoards([]boards.Board{right}, known)
	if len(rows) != 2 {
		t.Fatalf("got %+v", rows)
	}
	byOrder := map[string]boardRow{rows[0].Serial: rows[0], rows[1].Serial: rows[1]}
	if !byOrder["99C817E5"].OnUSB || byOrder["99C817E5"].Port != right.Port {
		t.Fatalf("right = %+v", byOrder["99C817E5"])
	}
	if byOrder["FBC116E9"].OnUSB || byOrder["FBC116E9"].name() != "3EB5" {
		t.Fatalf("left = %+v", byOrder["FBC116E9"])
	}
	// The order stays the same as boards come and go, so the bar doesn't jump around.
	if rows[0].Serial != "99C817E5" {
		t.Fatalf("got %+v", rows)
	}
}

func TestABoardWithNoIDIsNamedByItsSerial(t *testing.T) {
	rows := mergeBoards([]boards.Board{left}, nil)
	if rows[0].name() != "FBC116E9" {
		t.Fatalf("name = %q", rows[0].name())
	}
}

// Picking is where "never guess" lives for the TUI.
func TestAutoSelectOnlyPicksALoneBoard(t *testing.T) {
	tests := []struct {
		name      string
		current   string
		connected []boards.Board
		want      string
	}{
		{"a lone boot is selected for you", "", []boards.Board{left}, left.Serial},
		{"two boots stay unpicked", "", []boards.Board{left, right}, ""},
		{"nothing connected picks nothing", "", nil, ""},
		{"a choice stands when another boot appears", left.Serial, []boards.Board{left, right}, left.Serial},
		{"a chosen boot that's unplugged stays chosen", left.Serial, []boards.Board{right}, left.Serial},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := autoSelect(test.current, test.connected); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestCycleOnlyVisitsBoardsOnUSB(t *testing.T) {
	rows := []boardRow{
		{Serial: "A", OnUSB: true},
		{Serial: "B"},
		{Serial: "C", OnUSB: true},
	}
	if got := cycleBoard("", rows, 1); got != "A" {
		t.Fatalf("from nothing: %q", got)
	}
	if got := cycleBoard("A", rows, 1); got != "C" {
		t.Fatalf("from A: %q", got)
	}
	if got := cycleBoard("C", rows, 1); got != "A" {
		t.Fatalf("wrapping: %q", got)
	}
	if got := cycleBoard("A", rows, -1); got != "C" {
		t.Fatalf("backward: %q", got)
	}
	if got := cycleBoard("B", rows, 1); got != "C" {
		t.Fatalf("from one that's gone: %q", got)
	}
	if got := cycleBoard("A", nil, 1); got != "A" {
		t.Fatalf("no boards: %q", got)
	}
}

func TestTagSaysWhatsRunning(t *testing.T) {
	tests := []struct {
		name     string
		answered bool
		record   boards.Record
		want     string
	}{
		{"it answered status", true, boards.Record{LastFlashed: "bench flow"}, "app"},
		{"a bench build can't answer", false, boards.Record{LastFlashed: "bench flow"}, "bench flow"},
		{"a whole-firmware build can't either", false, boards.Record{LastFlashed: "imu_debug"}, "imu_debug"},
		{"the app was flashed but isn't answering", false, boards.Record{LastFlashed: "final_app"}, "unknown"},
		{"nothing known", false, boards.Record{}, "unknown"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := tagFor(test.answered, test.record); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}
