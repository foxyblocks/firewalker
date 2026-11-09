package pickboot_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/pickboot"
)

func TestSpaceSelectsSeveralBootsAndEnterRequiresASelection(t *testing.T) {
	m := pickboot.New("Identify", []boots.Boot{{ID: "AAAA", Serial: "one"}, {ID: "BBBB", Serial: "two"}})
	_, quit := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if quit != nil || len(m.Selected()) != 0 {
		t.Fatal("Enter with no selection must stay in the picker")
	}
	m.Update(tea.KeyMsg{Type: tea.KeySpace})
	m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m.Update(tea.KeyMsg{Type: tea.KeySpace})
	_, quit = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	selected := m.Selected()
	if quit == nil || len(selected) != 2 || selected[0].ID != "AAAA" || selected[1].ID != "BBBB" {
		t.Fatalf("selected = %+v, quit = %v", selected, quit)
	}
}

func TestActionMenuRunsAgainOnEnterWithoutLosingTheSelection(t *testing.T) {
	calls := 0
	m := pickboot.NewAction(context.Background(), "Identify", []boots.Boot{{ID: "AAAA", Serial: "one"}}, func(_ context.Context, selected []boots.Boot, progress func(string)) (string, error) {
		calls++
		if len(selected) != 1 || selected[0].ID != "AAAA" {
			return "", fmt.Errorf("wrong selection: %+v", selected)
		}
		progress("Blinking AAAA")
		return "AAAA — blink acknowledged", nil
	})
	m.Update(tea.KeyMsg{Type: tea.KeySpace})
	for expected := 1; expected <= 2; expected++ {
		_, command := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
		for command != nil {
			msg := command()
			if _, quit := msg.(tea.QuitMsg); quit {
				t.Fatal("Enter closed the action menu")
			}
			_, command = m.Update(msg)
		}
		if calls != expected || len(m.Selected()) != 1 || !strings.Contains(m.View(), "blink acknowledged") {
			t.Fatalf("calls=%d, view=%s", calls, m.View())
		}
	}
	_, quit := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if quit == nil {
		t.Fatal("Esc must close the action menu")
	}
}
