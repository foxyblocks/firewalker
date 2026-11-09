// Package pickboot supplies the same multi-boot selection menu to install,
// identify, and debug. A selection menu returns checked boots on Enter. An action
// menu runs on Enter and keeps the selection and results visible for another run.
// Merely moving or checking a row never performs an action.
package pickboot

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/boots"
)

var ErrCanceled = errors.New("boot selection canceled")

// Action runs on a snapshot of the checked boots. It can publish progress while
// working and returns the result to keep in the menu. It must honor cancellation
// so quitting can finish cleanup and release hardware connections.
type Action func(context.Context, []boots.Boot, func(string)) (string, error)

type actionProgress string
type actionFinished struct {
	message string
	err     error
}

type Model struct {
	title     string
	boots     []boots.Boot
	checked   []bool
	cursor    int
	confirmed bool
	canceled  bool
	notice    string
	ctx       context.Context
	action    Action
	busy      bool
	updates   <-chan tea.Msg
	running   sync.WaitGroup
}

func New(title string, connected []boots.Boot) *Model {
	return &Model{title: title, boots: connected, checked: make([]bool, len(connected))}
}

func NewAction(ctx context.Context, title string, connected []boots.Boot, action Action) *Model {
	model := New(title, connected)
	model.ctx, model.action = ctx, action
	return model
}

func (m *Model) Init() tea.Cmd { return nil }

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case actionProgress:
		m.notice = string(msg)
		return m, m.waitAction()
	case actionFinished:
		m.busy, m.updates = false, nil
		m.notice = msg.message
		if msg.err != nil {
			if m.notice != "" {
				m.notice += "\n  "
			}
			m.notice += msg.err.Error()
		}
		return m, nil
	}
	if key, ok := msg.(tea.KeyMsg); ok {
		switch key.String() {
		case "ctrl+c", "esc", "q":
			m.canceled = true
			return m, tea.Quit
		case "up", "k":
			m.cursor = max(0, m.cursor-1)
		case "down", "j":
			m.cursor = min(len(m.boots)-1, m.cursor+1)
		case " ":
			if len(m.boots) > 0 {
				m.checked[m.cursor] = !m.checked[m.cursor]
				if !m.busy {
					m.notice = ""
				}
			}
		case "a":
			all := true
			for _, checked := range m.checked {
				all = all && checked
			}
			for n := range m.checked {
				m.checked[n] = !all
			}
			if !m.busy {
				m.notice = ""
			}
		case "enter":
			if m.busy {
				return m, nil
			}
			if len(m.Selected()) == 0 {
				m.notice = "Press Space to select at least one boot."
				return m, nil
			}
			if m.action != nil {
				return m, m.startAction()
			}
			m.confirmed = true
			return m, tea.Quit
		}
	}
	return m, nil
}

// Launch work as Enter is handled, before returning the waiting command. This
// lets RunAction join it reliably even if the next key quits before Bubble Tea
// has started that waiting command. Only Update changes visible model state.
func (m *Model) startAction() tea.Cmd {
	selected := m.Selected()
	updates := make(chan tea.Msg, 16)
	m.updates, m.busy, m.notice = updates, true, "Running…"
	m.running.Add(1)
	go func() {
		defer m.running.Done()
		emit := func(msg tea.Msg) {
			select {
			case updates <- msg:
			case <-m.ctx.Done():
			}
		}
		message, err := m.action(m.ctx, selected, func(text string) { emit(actionProgress(text)) })
		emit(actionFinished{message: message, err: err})
	}()
	return m.waitAction()
}

func (m *Model) waitAction() tea.Cmd {
	updates := m.updates
	return func() tea.Msg {
		select {
		case msg := <-updates:
			return msg
		case <-m.ctx.Done():
			return nil
		}
	}
}

func (m *Model) View() string {
	var out strings.Builder
	fmt.Fprintf(&out, "\n  %s — choose boots\n\n", m.title)
	for n, b := range m.boots {
		cursor, check := " ", " "
		if n == m.cursor {
			cursor = ">"
		}
		if m.checked[n] {
			check = "x"
		}
		detail := "app"
		if b.Status != nil {
			detail = fmt.Sprintf("app · protocol %d", b.Status.Proto)
		}
		if b.Problem != "" {
			detail = b.Problem
		}
		if b.Remembered {
			detail += " · remembered ID"
		}
		fmt.Fprintf(&out, "  %s [%s] %-8s  USB %s  %s\n        %s\n", cursor, check, b.Name(), b.Serial, b.Port, detail)
	}
	if m.notice != "" {
		fmt.Fprintf(&out, "\n  %s\n", m.notice)
	}
	if m.action != nil {
		fmt.Fprintln(&out, "\n  ↑/↓ move · Space select · a all · Enter run again · q/Esc close")
	} else {
		fmt.Fprintln(&out, "\n  ↑/↓ move · Space select · a toggle all · Enter continue · Esc cancel")
	}
	return out.String()
}

// RunAction keeps the menu open after each run. Results and checked rows survive
// Enter; q/Esc ends the menu and cancels/joins an in-flight action before returning.
func RunAction(ctx context.Context, title string, connected []boots.Boot, in io.Reader, out io.Writer, action Action) error {
	actionCtx, cancel := context.WithCancel(ctx)
	model := NewAction(actionCtx, title, connected, action)
	_, err := tea.NewProgram(model, tea.WithContext(ctx), tea.WithInput(in), tea.WithOutput(out)).Run()
	cancel()
	model.running.Wait()
	return err
}

func (m *Model) Selected() []boots.Boot {
	var selected []boots.Boot
	for n, checked := range m.checked {
		if checked {
			selected = append(selected, m.boots[n])
		}
	}
	return selected
}

// Run owns terminal input only while the menu is visible. The resulting action
// runs after Bubble Tea restores the terminal, so headless output stays readable.
func Run(ctx context.Context, title string, connected []boots.Boot, in io.Reader, out io.Writer) ([]boots.Boot, error) {
	model := New(title, connected)
	_, err := tea.NewProgram(model, tea.WithContext(ctx), tea.WithInput(in), tea.WithOutput(out)).Run()
	if err != nil {
		return nil, err
	}
	if model.canceled || !model.confirmed {
		return nil, ErrCanceled
	}
	return model.Selected(), nil
}
