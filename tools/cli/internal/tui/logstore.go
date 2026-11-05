package tui

import (
	"strings"
	"time"

	"firewalker/cli/internal/theme"
)

// maxLogEntries caps memory for a long session. Motion lines arrive five times a second,
// so this holds several minutes of a busy log.
const maxLogEntries = 5000

// logGroup is what the log's filters switch on and off.
type logGroup int

const (
	groupReplies logGroup = iota // commands sent, and the boot's replies to them
	groupLogs                    // the firmware's own log lines, and the tool's notes
	groupMotion                  // live sensor lines
	groupBuild                   // PlatformIO output
	groupCount
)

var groupNames = [groupCount]string{"replies", "logs", "motion", "build"}

type logEntry struct {
	Seq   int
	At    time.Time
	Kind  theme.Kind
	Group logGroup
	Text  string
}

// logStore holds every line of a session along with how it's being viewed: which groups
// are hidden, what's being searched for, and whether the view is paused or scrolled
// back. The small pane and the full Log screen share one store, so a filter set on one
// applies to the other.
type logStore struct {
	entries  []logEntry
	nextSeq  int
	hidden   [groupCount]bool
	search   string
	paused   bool
	pausedAt int // the newest Seq shown while paused
	offset   int // how many visible lines back from the newest the view sits
}

func (l *logStore) add(at time.Time, kind theme.Kind, group logGroup, text string) {
	entry := logEntry{Seq: l.nextSeq, At: at, Kind: kind, Group: group, Text: text}
	l.nextSeq++
	l.entries = append(l.entries, entry)
	if len(l.entries) > maxLogEntries {
		l.entries = append(l.entries[:0], l.entries[len(l.entries)-maxLogEntries:]...)
	}
	// Someone scrolled back is reading, so a new line shouldn't move what they see.
	if l.offset > 0 && !l.paused && l.matches(entry) {
		l.offset++
	}
}

// matches applies the filters, leaving aside pause.
func (l *logStore) matches(e logEntry) bool {
	if l.hidden[e.Group] {
		return false
	}
	return l.search == "" || strings.Contains(strings.ToLower(e.Text), strings.ToLower(l.search))
}

func (l *logStore) visible() []logEntry {
	var out []logEntry
	for _, e := range l.entries {
		if l.matches(e) && (!l.paused || e.Seq <= l.pausedAt) {
			out = append(out, e)
		}
	}
	return out
}

// window returns the lines that fit in a pane of the given height, oldest first.
func (l *logStore) window(height int) []logEntry {
	lines := l.visible()
	end := max(len(lines)-l.offset, 0)
	start := max(end-height, 0)
	return lines[start:end]
}

// scroll moves the view back through history for a positive delta, and forward for a
// negative one, stopping at both ends for a pane of the given height.
func (l *logStore) scroll(delta, height int) {
	furthest := max(len(l.visible())-height, 0)
	l.offset = min(max(l.offset+delta, 0), furthest)
}

func (l *logStore) toBottom() { l.offset = 0 }

func (l *logStore) toggle(group logGroup) {
	l.hidden[group] = !l.hidden[group]
	l.offset = 0
}

func (l *logStore) togglePause() {
	l.paused = !l.paused
	if l.paused {
		l.pausedAt = l.nextSeq - 1
	} else {
		l.offset = 0
	}
}
