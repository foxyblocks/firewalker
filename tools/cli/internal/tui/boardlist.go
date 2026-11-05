package tui

import (
	"slices"
	"strings"

	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/flash"
)

// boardRow is one boot in the board bar: on USB now, or remembered from before. Showing
// a remembered boot as "not on USB" is what points at a charge-only cable or a hub,
// where otherwise it would just silently be missing.
type boardRow struct {
	Serial string
	Port   string
	OnUSB  bool
	Record boards.Record
}

// name is what the TUI calls a boot: its own id once it has given one, such as 3ED8.
func (r boardRow) name() string {
	if r.Record.ID != "" {
		return r.Record.ID
	}
	return r.Serial
}

// mergeBoards combines what's on USB with what's remembered. Sorting by serial keeps each
// boot in the same place in the bar as others come and go.
func mergeBoards(connected []boards.Board, known map[string]boards.Record) []boardRow {
	rows := map[string]boardRow{}
	for serial, record := range known {
		rows[serial] = boardRow{Serial: serial, Record: record}
	}
	for _, b := range connected {
		row := rows[b.Serial]
		row.Serial, row.Port, row.OnUSB = b.Serial, b.Port, true
		rows[b.Serial] = row
	}
	list := make([]boardRow, 0, len(rows))
	for _, row := range rows {
		list = append(list, row)
	}
	slices.SortFunc(list, func(a, b boardRow) int { return strings.Compare(a.Serial, b.Serial) })
	return list
}

// autoSelect applies the never-guess rule to the selection. A lone boot on USB is
// unambiguous, so it's selected for you. A choice already made stands, even for a boot
// that's been unplugged, because silently moving to another boot is how the wrong shoe
// gets flashed.
func autoSelect(current string, connected []boards.Board) string {
	if current == "" && len(connected) == 1 {
		return connected[0].Serial
	}
	return current
}

// cycleBoard finds the next boot on USB, for moving the picker's cursor. A boot that isn't
// on USB can't be talked to, so it's skipped.
func cycleBoard(current string, rows []boardRow, step int) string {
	var online []string
	for _, row := range rows {
		if row.OnUSB {
			online = append(online, row.Serial)
		}
	}
	count := len(online)
	if count == 0 {
		return current
	}
	if current == "" {
		return online[0]
	}
	// Rows are sorted, so a search also finds where an unplugged boot would sit, and the
	// next boot along is already at that spot.
	index, found := slices.BinarySearch(online, current)
	if found || step < 0 {
		index += step
	}
	return online[(index%count+count)%count]
}

// tagFor says what a boot is running: `app` if it answered `status`, otherwise what this
// tool last flashed to it. The app having been flashed earlier doesn't count, because if
// it's really running then it should be answering.
func tagFor(answered bool, record boards.Record) string {
	switch {
	case answered:
		return "app"
	case record.LastFlashed != "" && record.LastFlashed != flash.AppEnv:
		return record.LastFlashed
	}
	return "unknown"
}
