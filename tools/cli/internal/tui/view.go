package tui

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/charmbracelet/x/ansi"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/flash"
	"firewalker/cli/internal/protocol"
)

// View draws the frame every screen shares, top to bottom: the board bar and navigation,
// the screen's body, the stage line, the log pane, and then the prompt and key hints.
// The body gets whatever height is left, so the log and the prompt can't push the frame
// off screen.
func (m *Model) View() string {
	top := []string{m.viewBar(), m.viewNav(), m.rule()}
	stage := m.viewStage()
	pane := m.viewLogPane()
	bottom := []string{m.rule(), m.viewPrompt(), m.viewKeys()}
	bodyHeight := max(m.height-len(top)-len(stage)-len(pane)-len(bottom), 1)

	body := m.viewBody(bodyHeight)
	if len(body) > bodyHeight {
		body = body[:bodyHeight]
	}
	for len(body) < bodyHeight {
		body = append(body, "")
	}

	lines := append(append(append(append(top, body...), stage...), pane...), bottom...)
	for i, line := range lines {
		lines[i] = ansi.Truncate(line, m.width, "…")
	}
	return strings.Join(lines, "\n")
}

func (m *Model) rule() string {
	return m.th.Dim.Render(strings.Repeat("─", max(m.width, 1)))
}

// viewBar lists each boot: ● is the picked one, and its tag says what's running on it.
// What to do about the boards goes on the prompt line, where a long bar can't cut it off.
func (m *Model) viewBar() string {
	parts := []string{" " + m.th.Title.Render("FIREWALKER")}
	for _, row := range m.rows {
		parts = append(parts, m.viewBarRow(row))
	}
	return strings.Join(parts, "   ")
}

func (m *Model) viewBarRow(row boardRow) string {
	mark := "○"
	picked := row.Serial == m.selected
	if picked {
		mark = "●"
	}
	text := []string{mark + " " + row.name()}
	if !row.OnUSB {
		text = append(text, "not on USB")
	} else {
		answered := picked && m.answered()
		text = append(text, tagFor(answered, row.Record))
		if row.Record.Layout != nil {
			text = append(text, fmt.Sprintf("%d LEDs", row.Record.Layout.LEDs))
		}
	}
	joined := strings.Join(text, " · ")
	if picked {
		return m.th.Accent.Render(joined)
	}
	return m.th.Dim.Render(joined)
}

func (m *Model) viewNav() string {
	tab := func(s screen, label string) string {
		if m.screen == s {
			return m.th.Selected.Render(" " + label + " ")
		}
		return " " + label + " "
	}
	return " " + m.th.Dim.Render("FLASH") + " " + tab(screenBench, "1 Bench test") + tab(screenBuilds, "2 Builds") +
		"    " + m.th.Dim.Render("DEBUG") + " " + tab(screenBoot, "3 Boot") + tab(screenLog, "5 Log")
}

func (m *Model) viewBody(height int) []string {
	if m.showHelp {
		return m.viewHelp()
	}
	switch m.screen {
	case screenBuilds:
		return m.viewBuilds()
	case screenBoot:
		return m.viewBoot()
	case screenLog:
		return m.viewLogScreen(height)
	}
	return m.viewBench()
}

func (m *Model) heading(path string) string {
	target := "pick a boot with tab"
	if row, ok := m.selectedRow(); ok {
		target = "target: " + row.name()
	}
	return " " + m.th.Bold.Render(path) + "   " + m.th.Dim.Render(target)
}

// viewBench draws the form, its live command preview, and its keys.
func (m *Model) viewBench() []string {
	lines := []string{m.heading("FLASH › Bench test"), ""}
	for _, field := range m.form.fields() {
		lines = append(lines, m.viewField(field))
	}
	lines = append(lines, "")
	if preview := m.form.preview(m.previewSerial()); strings.HasPrefix(preview, "✗") {
		lines = append(lines, "   "+m.th.Error.Render(preview))
	} else {
		lines = append(lines, "   "+m.th.Accent.Render(preview))
	}
	lines = append(lines, "", "   "+m.th.Dim.Render(m.benchHint()))
	return lines
}

func (m *Model) benchHint() string {
	if m.formEditing {
		return "type a value    enter keep    esc cancel"
	}
	hint := "enter build + flash    b build only    ↑↓ move    ←→ change"
	if m.form.isEditable(m.form.focused()) {
		hint += "    e type a value"
	}
	return hint
}

var fieldLabels = map[fieldID]string{
	fieldTest: "Test", fieldInput: "Input", fieldTilt: "Tilt", fieldStomp: "Stomp every",
	fieldLogMotion: "Log motion", fieldLEDs: "LEDs", fieldToe: "Toe", fieldHeel: "Heel",
	fieldColor: "Color", fieldInterval: "Interval", fieldLit: "Lit", fieldBrightness: "Brightness",
}

func (m *Model) viewField(field fieldID) string {
	form := m.form
	cursor, label := "   ", fmt.Sprintf("%-13s", fieldLabels[field])
	focused := form.focused() == field
	if focused {
		cursor = " " + m.th.Accent.Render("›") + " "
		label = m.th.Accent.Render(label)
	}
	if focused && m.formEditing {
		return cursor + label + " " + m.formInput.View()
	}
	return cursor + label + " " + m.fieldValue(field)
}

func (m *Model) fieldValue(field fieldID) string {
	form := m.form
	switch field {
	case fieldTest:
		choices := make([]string, len(testOrder))
		for i, test := range testOrder {
			choices[i] = bench.TestNames[test]
		}
		return m.viewChoices(choices, indexOf(testOrder, form.test))
	case fieldInput:
		chosen := 0
		if form.motion {
			chosen = 1
		}
		return m.viewChoices([]string{"simulated", "motion"}, chosen)
	case fieldLogMotion:
		if form.logMotion {
			return "on"
		}
		return "off"
	case fieldTilt:
		return m.viewTilt(form.values[fieldTilt])
	case fieldLEDs:
		return form.values[fieldLEDs] + "    " + m.th.Dim.Render(form.layoutNote())
	case fieldLit:
		if form.values[fieldLit] == "" {
			return "all"
		}
	case fieldBrightness:
		return form.values[fieldBrightness] + " / 255"
	}
	return form.values[field]
}

func (m *Model) viewChoices(choices []string, chosen int) string {
	parts := make([]string, len(choices))
	for i, choice := range choices {
		if i == chosen {
			parts[i] = m.th.Bold.Render("▸ " + choice)
		} else {
			parts[i] = m.th.Dim.Render("  " + choice)
		}
	}
	return strings.Join(parts, "  ")
}

// viewTilt draws a tilt as a position between heel and toe. Text that isn't a number yet
// shows as typed, and the preview says what's wrong with it.
func (m *Model) viewTilt(text string) string {
	tilt, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(tilt) || tilt < -1 || tilt > 1 {
		return text
	}
	const width = 21
	position := int(math.Round((tilt + 1) / 2 * (width - 1)))
	track := strings.Repeat("─", position) + "●" + strings.Repeat("─", width-1-position)
	return fmt.Sprintf("heel %s toe   %+.2f", track, tilt)
}

func (m *Model) viewBuilds() []string {
	lines := []string{m.heading("FLASH › Builds"), ""}
	for i, build := range flash.Builds {
		cursor := "   "
		name := fmt.Sprintf("%-18s", build.Name)
		if i == m.buildCursor {
			cursor = " " + m.th.Accent.Render("▸") + " "
			name = m.th.Accent.Render(name)
		}
		lines = append(lines, cursor+name+" "+m.th.Dim.Render(build.Description))
	}
	lines = append(lines, "")
	if row, ok := m.selectedRow(); ok {
		running := "Running now: " + tagFor(m.answered(), row.Record)
		if !m.answered() && row.Record.LastFlashed != "" && row.Record.LastFlashed != flash.AppEnv {
			running += ", flashed by cli at " + row.Record.FlashedAt.Local().Format("15:04")
		}
		lines = append(lines, "   "+running, "")
	}
	return append(lines, "   "+m.th.Dim.Render("enter flash    A flash the app to both boots    b build only"))
}

// viewBoot shows what the running app reports about itself. It's read-only on purpose:
// settings change on the phone, and this confirms what the boot holds.
func (m *Model) viewBoot() []string {
	row, ok := m.selectedRow()
	if !ok {
		return []string{m.heading("DEBUG › Boot"), "", "   Pick a boot with tab."}
	}
	if m.status == nil {
		lines := []string{
			m.heading("DEBUG › Boot"), "",
			"   " + row.name() + " isn't answering status. It's tagged " + m.th.Bold.Render(tagFor(false, row.Record)) + ".",
		}
		if saved := row.Record.Layout; saved != nil {
			lines = append(lines, fmt.Sprintf("   Last known layout: %d LEDs   toe %d   heel %d", saved.LEDs, saved.Toe, saved.Heel))
		}
		return append(lines, "", "   "+m.th.Dim.Render("a flash the app    r ask again"))
	}

	s := m.status
	field := func(label, value string) string { return fmt.Sprintf("   %-12s %s", label, value) }
	heading := fmt.Sprintf(" %s   %s", m.th.Bold.Render("DEBUG › Boot"), m.th.Dim.Render(fmt.Sprintf("%s · proto %d · app", s.ID, s.Proto)))
	lines := []string{heading, ""}

	power := "power on"
	if s.Pattern == "off" {
		power = "power off, returns to " + s.Lit
	}
	lines = append(lines, field("Pattern", fmt.Sprintf("%s   brightness %d / %d   %s", s.Pattern, s.Brightness, s.MaxBrightness, power)))
	if layout, ok := s.Layout(); ok {
		preview := "preview off"
		if s.Preview {
			preview = "preview on"
		}
		lines = append(lines, field("Strip", fmt.Sprintf("%d LEDs   toe %d   heel %d   %s", layout.LEDs, layout.Toe, layout.Heel, preview)))
	} else {
		lines = append(lines, field("Strip", m.th.Warn.Render(fmt.Sprintf("proto %d doesn't report a layout", s.Proto))))
	}
	sensor := s.Sensor
	if sensor != "ok" {
		sensor = m.th.Error.Render(sensor)
	}
	lines = append(lines, field("Sensor", fmt.Sprintf("%s   tilt %+.2f", sensor, s.Tilt)))
	lines = append(lines, field("Poses", fmt.Sprintf("neutral %.1f°   heel %s   toe %s", s.NeutralDeg, formatPose(s.HeelDeg), formatPose(s.ToeDeg))))
	flashState := "saved ✓"
	switch {
	case s.SaveFailed:
		flashState = m.th.Error.Render("last save failed")
	case !s.Saved:
		flashState = "saving…"
	}
	lines = append(lines, field("Flash", fmt.Sprintf("%s   %d writes since boot", flashState, s.Saves)))
	ble := "no client"
	if s.BLE {
		ble = "phone connected"
	}
	lines = append(lines, field("BLE", ble))
	motion := "motion lines off"
	if s.Debug {
		motion = "motion lines on"
	}
	lines = append(lines, field("Debug", motion))
	return append(lines, "", "   "+m.th.Dim.Render("r refresh    i identify    d motion lines on/off"))
}

func formatPose(degrees *float64) string {
	if degrees == nil {
		return "—"
	}
	return fmt.Sprintf("%.1f°", *degrees)
}

// viewStage is the flash's stage line, plus the reason when one failed. The reason stays
// here after the rest of the output scrolls away.
func (m *Model) viewStage() []string {
	switch m.stage {
	case flash.StageIdle:
		return nil
	case flash.StageBuilding, flash.StageUploading:
		return []string{" " + m.th.Accent.Render(m.spin.View()+" "+m.stage.String()+" "+m.stageOf)}
	case flash.StageRunning:
		return []string{" " + m.th.OK.Render("✓ running "+m.stageOf)}
	}
	return []string{
		" " + m.th.Error.Render("✗ failed "+m.stageOf),
		" " + m.th.Error.Render(m.failure),
	}
}

// logPaneHeight is how many log lines fit in the pane under a screen. The Log screen has
// no pane, since it's already all log.
func (m *Model) logPaneHeight() int {
	if m.screen == screenLog {
		return 0
	}
	switch m.logSize {
	case logSmall:
		return 5
	case logHalf:
		return max((m.height-6)/2, 1)
	}
	return 0
}

func (m *Model) viewLogPane() []string {
	height := m.logPaneHeight()
	if height == 0 {
		return nil
	}
	var filters []string
	for group, name := range groupNames {
		if !m.log.hidden[group] {
			filters = append(filters, name)
		}
	}
	label := "─ log "
	if m.log.paused {
		label = "─ log (paused) "
	}
	summary := " " + strings.Join(filters, " · ") + " ──"
	fill := max(m.width-len([]rune(label))-len([]rune(summary)), 0)
	lines := []string{m.th.Dim.Render(label + strings.Repeat("─", fill) + summary)}
	for _, entry := range m.log.window(height) {
		lines = append(lines, " "+m.th.Line(entry.At, entry.Kind, entry.Text))
	}
	return lines
}

// logViewHeight is how many log lines are showing, wherever the log is on screen.
func (m *Model) logViewHeight() int {
	if m.screen == screenLog {
		return m.logBodyHeight()
	}
	return m.logPaneHeight()
}

// logBodyHeight is how many lines the full Log screen shows below its filter row.
func (m *Model) logBodyHeight() int {
	return max(m.height-6-len(m.viewStage())-1, 1)
}

func (m *Model) viewLogScreen(height int) []string {
	check := func(group logGroup, key string) string {
		box := "▣"
		if m.log.hidden[group] {
			box = "□"
		}
		return box + " " + key + " " + groupNames[group]
	}
	header := fmt.Sprintf(" %s   %s  %s  %s  %s", m.th.Bold.Render("LOG"),
		check(groupReplies, "r"), check(groupLogs, "f"), check(groupMotion, "m"), check(groupBuild, "b"))
	switch {
	case m.searching:
		header += "   " + m.searchInput.View()
	case m.log.search != "":
		header += "   " + m.th.Accent.Render("/ "+m.log.search)
	default:
		header += "   " + m.th.Dim.Render("/ search")
	}
	if m.log.paused {
		header += "   " + m.th.Warn.Render("paused (space)")
	}
	lines := []string{header}
	for _, entry := range m.log.window(max(height-1, 1)) {
		lines = append(lines, " "+m.th.Line(entry.At, entry.Kind, entry.Text))
	}
	return lines
}

// viewPrompt is the one line that asks or tells something: a confirm, the console, a note
// about the last key pressed, or else what the boards need next.
func (m *Model) viewPrompt() string {
	switch {
	case m.confirm != nil:
		return " " + m.th.Warn.Render(m.confirm.Text)
	case m.console.open:
		return " " + m.console.input.View()
	case m.notice != "":
		return " " + m.th.Warn.Render(m.notice)
	case len(m.connected) == 0:
		return " " + m.th.Warn.Render(boards.ErrNoBoards.Error())
	case m.selected == "":
		return " " + m.th.Warn.Render("Press tab to pick a boot.")
	case m.status != nil && m.status.Proto < protocol.ExpectedProto:
		return " " + m.th.Warn.Render(fmt.Sprintf("%s is on old firmware (proto %d). Press a to update it.", m.status.ID, m.status.Proto))
	}
	return ""
}

// viewKeys is the key hints, for whatever has the keyboard right now.
func (m *Model) viewKeys() string {
	if m.confirm != nil {
		return m.th.Dim.Render(" enter flash · esc cancel")
	}
	if m.console.open {
		return m.th.Dim.Render(" enter send · tab complete · ↑↓ history · esc close")
	}
	if m.screen == screenLog {
		return m.th.Dim.Render(" tab boot   1-5 screen   space pause   ↑↓ scroll   g/G ends   a app   : console   ? help   q quit")
	}
	return m.th.Dim.Render(" tab boot   1-5 screen   a app   : console   l log size   ? help   q quit")
}

func (m *Model) viewHelp() []string {
	line := func(keys, what string) string { return fmt.Sprintf("   %-14s %s", keys, what) }
	return []string{
		" " + m.th.Bold.Render("Help") + "   " + m.th.Dim.Render("any key closes this"), "",
		line("tab", "switch boots; nothing flashes or sends until one is picked"),
		line("1 2 3 5", "Bench test, Builds, Boot, Log"),
		line("a", "flash the app to the picked boot; saved settings stay"),
		line("A", "flash the app to both boots, one after the other"),
		line(":", "send any protocol line to the boot"),
		line("l", "cycle the log: small, half, hidden"),
		line("pgup pgdn", "scroll the log"),
		line("q", "quit and leave the board running"),
		"",
		"   Pattern, brightness, power, calibration, and the strip layout live on the phone.",
	}
}
