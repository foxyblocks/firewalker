package tui

import (
	tea "github.com/charmbracelet/bubbletea"

	"firewalker/cli/internal/flash"
)

// handleKey routes a key to whatever currently owns the keyboard. Anything that captures
// typing comes first, so a letter typed into a field can't also trigger a shortcut. Only
// Ctrl-C always works.
func (m *Model) handleKey(msg tea.KeyMsg) tea.Cmd {
	key := msg.String()
	if key == "ctrl+c" {
		return m.quit()
	}
	m.notice = ""
	switch {
	case m.confirm != nil:
		return m.handleConfirmKey(key)
	case m.console.open:
		return m.handleConsoleKey(msg)
	case m.showHelp:
		m.showHelp = false
		return nil
	case m.formEditing:
		return m.handleFormEditKey(msg)
	case m.searching:
		return m.handleSearchKey(msg)
	}

	switch key {
	case "q":
		if m.flashing() {
			m.notice = "A flash is running. Wait for it to finish, or press Ctrl-C to stop it and quit."
			return nil
		}
		return m.quit()
	case "?":
		m.showHelp = true
		return nil
	case "tab":
		return m.switchBoard(1)
	case "shift+tab":
		return m.switchBoard(-1)
	case "1":
		m.screen = screenBench
		return nil
	case "2":
		m.screen = screenBuilds
		return nil
	case "3":
		m.screen = screenBoot
		return nil
	case "4":
		m.notice = "The motion scope comes later. Motion lines show in the log for now."
		return nil
	case "5":
		m.screen = screenLog
		return nil
	case "a":
		m.askFlashApp()
		return nil
	case "A":
		m.askFlashBoth()
		return nil
	case ":":
		return m.console.start()
	case "l":
		m.logSize = (m.logSize + 1) % logSizeCount
		return nil
	case "pgup":
		m.log.scroll(m.logViewHeight(), m.logViewHeight())
		return nil
	case "pgdown":
		m.log.scroll(-m.logViewHeight(), m.logViewHeight())
		return nil
	}

	switch m.screen {
	case screenBench:
		return m.handleBenchKey(msg)
	case screenBuilds:
		return m.handleBuildsKey(key)
	case screenBoot:
		m.handleBootKey(key)
	case screenLog:
		return m.handleLogKey(key)
	}
	return nil
}

// switchBoard is `tab`. With one boot there's nowhere to go, and reconnecting would only
// make the bar blink, so staying put does nothing.
func (m *Model) switchBoard(step int) tea.Cmd {
	next := cycleBoard(m.selected, m.rows, step)
	if next == m.selected {
		return nil
	}
	return m.selectBoard(next)
}

// quit leaves the board running: closing the port doesn't change anything on it. A flash
// still going gets stopped by Shutdown on the way out.
func (m *Model) quit() tea.Cmd {
	if m.job != nil {
		m.job.cancel()
	}
	return tea.Quit
}

func (m *Model) handleConfirmKey(key string) tea.Cmd {
	switch key {
	case "enter", "y":
		items := m.confirm.Items
		m.confirm = nil
		return m.startItems(items)
	case "esc", "n":
		m.confirm = nil
	}
	return nil
}

func (m *Model) handleConsoleKey(msg tea.KeyMsg) tea.Cmd {
	c := &m.console
	switch msg.String() {
	case "esc":
		c.close()
		return nil
	case "enter":
		line := c.submit()
		c.close()
		if line != "" {
			m.send(line)
		}
		return nil
	case "tab":
		c.complete()
		return nil
	case "up":
		c.walkHistory(1)
		return nil
	case "down":
		c.walkHistory(-1)
		return nil
	}
	c.matches = nil
	var cmd tea.Cmd
	c.input, cmd = c.input.Update(msg)
	return cmd
}

func (m *Model) handleBenchKey(msg tea.KeyMsg) tea.Cmd {
	form := m.form
	switch msg.String() {
	case "up", "k":
		form.move(-1)
	case "down", "j":
		form.move(1)
	case "left":
		form.adjust(-1)
	case "right":
		form.adjust(1)
	case " ":
		if !form.isEditable(form.focused()) {
			form.adjust(1)
		}
	case "e":
		if form.isEditable(form.focused()) {
			m.formEditing = true
			form.focus = form.focused()
			m.formInput.SetValue(form.values[form.focus])
			m.formInput.CursorEnd()
			return m.formInput.Focus()
		}
	case "enter":
		return m.askFlashBench(false)
	case "b":
		return m.askFlashBench(true)
	}
	return nil
}

func (m *Model) handleFormEditKey(msg tea.KeyMsg) tea.Cmd {
	form := m.form
	switch msg.String() {
	case "esc":
		m.formEditing = false
		m.formInput.Blur()
		return nil
	case "enter", "up", "down":
		form.values[form.focus] = m.formInput.Value()
		m.formEditing = false
		m.formInput.Blur()
		if msg.String() == "up" {
			form.move(-1)
		} else if msg.String() == "down" {
			form.move(1)
		}
		return nil
	}
	var cmd tea.Cmd
	m.formInput, cmd = m.formInput.Update(msg)
	return cmd
}

func (m *Model) handleBuildsKey(key string) tea.Cmd {
	switch key {
	case "up", "k":
		m.buildCursor = (m.buildCursor - 1 + len(flash.Builds)) % len(flash.Builds)
	case "down", "j":
		m.buildCursor = (m.buildCursor + 1) % len(flash.Builds)
	case "enter":
		return m.askFlashBuild(flash.Builds[m.buildCursor], false)
	case "b":
		return m.askFlashBuild(flash.Builds[m.buildCursor], true)
	}
	return nil
}

// handleBootKey covers the Boot screen's few actions. None of them change a saved
// setting: identify blinks the strip, and debug only turns motion lines on or off.
func (m *Model) handleBootKey(key string) {
	switch key {
	case "r":
		m.send("status")
	case "i":
		m.send("identify")
	case "d":
		if m.status != nil && m.status.Debug {
			m.send("debug off")
		} else {
			m.send("debug on")
		}
	}
}

func (m *Model) handleLogKey(key string) tea.Cmd {
	height := m.logBodyHeight()
	switch key {
	case "r":
		m.log.toggle(groupReplies)
	case "f":
		m.log.toggle(groupLogs)
	case "m":
		m.log.toggle(groupMotion)
	case "b":
		m.log.toggle(groupBuild)
	case " ":
		m.log.togglePause()
	case "up", "k":
		m.log.scroll(1, height)
	case "down", "j":
		m.log.scroll(-1, height)
	case "g":
		m.log.scroll(len(m.log.entries), height)
	case "G":
		m.log.toBottom()
	case "/":
		m.searching = true
		m.searchInput.SetValue(m.log.search)
		m.searchInput.CursorEnd()
		return m.searchInput.Focus()
	}
	return nil
}

func (m *Model) handleSearchKey(msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		m.log.search = ""
		m.searching = false
		m.searchInput.Blur()
		return nil
	case "enter":
		m.searching = false
		m.searchInput.Blur()
		return nil
	}
	var cmd tea.Cmd
	m.searchInput, cmd = m.searchInput.Update(msg)
	m.log.search = m.searchInput.Value()
	m.log.offset = 0
	return cmd
}
