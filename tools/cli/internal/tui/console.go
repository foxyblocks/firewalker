package tui

import (
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/protocol"
)

// console is the `:` raw command line. It sends any protocol line to the picked boot,
// with history and tab completion. It's the debugging escape hatch rather than a second
// remote, and the only way this TUI changes a running boot's settings.
type console struct {
	open    bool
	input   textinput.Model
	history []string
	browse  int      // how far back through history; 0 is the line being typed
	draft   string   // the line being typed, kept while browsing history
	matches []string // the completions being cycled, from the text as first tabbed
	match   int
}

func newConsole() console {
	input := textinput.New()
	input.Prompt = ": "
	return console{input: input}
}

func (c *console) start() tea.Cmd {
	c.open, c.browse, c.matches = true, 0, nil
	c.input.SetValue("")
	return c.input.Focus()
}

func (c *console) close() {
	c.open = false
	c.input.Blur()
}

// complete fills in the next match. The first tab finds matches for what's typed, and
// later tabs cycle through them: "strip p" gives "strip preview on", then "strip preview
// off".
func (c *console) complete() {
	if c.matches == nil {
		c.matches = protocol.Completions(c.input.Value())
		c.match = 0
	} else {
		c.match++
	}
	if len(c.matches) == 0 {
		c.matches = nil
		return
	}
	c.input.SetValue(c.matches[c.match%len(c.matches)])
	c.input.CursorEnd()
}

// walkHistory moves through earlier commands: a positive step goes further back, and
// coming forward past the newest one restores what was being typed.
func (c *console) walkHistory(step int) {
	if c.browse == 0 {
		c.draft = c.input.Value()
	}
	c.browse = min(max(c.browse+step, 0), len(c.history))
	if c.browse == 0 {
		c.input.SetValue(c.draft)
	} else {
		c.input.SetValue(c.history[len(c.history)-c.browse])
	}
	c.input.CursorEnd()
}

// submit returns the line to send and records it. Repeating the same command doesn't
// fill the history with copies.
func (c *console) submit() string {
	line := c.input.Value()
	if line != "" && (len(c.history) == 0 || c.history[len(c.history)-1] != line) {
		c.history = append(c.history, line)
	}
	c.input.SetValue("")
	c.browse, c.matches = 0, nil
	return line
}
