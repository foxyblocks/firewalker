// Package theme is the tool's one look: the same colors and marks for the TUI's log and
// for plain subcommand output. Lip Gloss checks the output it's handed, so anything that
// isn't a terminal, or that sets NO_COLOR, gets plain text with no special handling here.
//
// Describe turns a boot's JSON reply into a readable line. That's display logic, so it
// lives here rather than in internal/protocol, which only knows what the lines mean.
package theme

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"firewalker/cli/internal/protocol"
)

// Kind is what a log line is, which sets its color and its mark.
type Kind int

const (
	KindInfo     Kind = iota // the tool's own notes, such as a stage changing
	KindSent                 // a command going to the boot
	KindOK                   // a reply saying it worked
	KindError                // a reply or a step saying it didn't
	KindFirmware             // the firmware's own log lines
	KindMotion               // live sensor lines
	KindBuild                // PlatformIO output
)

// Theme holds styles bound to one output.
type Theme struct {
	renderer *lipgloss.Renderer
	kinds    map[Kind]lipgloss.Style
	marks    map[Kind]string
	time     lipgloss.Style

	Title, Accent, Dim, Bold, OK, Warn, Error, Selected lipgloss.Style
}

// New builds a theme for one output, deciding from it whether to use color at all.
func New(w io.Writer) *Theme {
	r := lipgloss.NewRenderer(w)
	color := func(c string) lipgloss.Style { return r.NewStyle().Foreground(lipgloss.Color(c)) }
	gray, dim := color("245"), color("240")
	return &Theme{
		renderer: r,
		kinds: map[Kind]lipgloss.Style{
			KindInfo:     color("252"),
			KindSent:     color("80"),
			KindOK:       color("78"),
			KindError:    color("203"),
			KindFirmware: dim,
			KindMotion:   color("140"),
			KindBuild:    gray,
		},
		marks: map[Kind]string{
			KindInfo: "▸", KindSent: "→", KindOK: "✓", KindError: "✗",
			KindFirmware: "·", KindMotion: "~", KindBuild: "│",
		},
		time:     dim,
		Title:    color("214").Bold(true),
		Accent:   color("214"),
		Dim:      gray,
		Bold:     r.NewStyle().Bold(true),
		OK:       color("78"),
		Warn:     color("221"),
		Error:    color("203"),
		Selected: color("232").Background(lipgloss.Color("214")).Bold(true),
	}
}

// Colored says whether this output shows color. Subcommands use it to pick between
// styled lines for people and raw lines for scripts.
func (t *Theme) Colored() bool { return t.renderer.ColorProfile() != termenv.Ascii }

// Renderer is the Lip Gloss renderer for this output, for styles a caller builds itself.
func (t *Theme) Renderer() *lipgloss.Renderer { return t.renderer }

// Line formats one log line: time, mark, then text in the kind's color.
func (t *Theme) Line(at time.Time, kind Kind, text string) string {
	style := t.kinds[kind]
	return t.time.Render(at.Format("15:04:05")) + "  " + style.Render(t.marks[kind]) + "  " + style.Render(text)
}

// Describe sorts a boot's line and writes it for a person. A log line stays exactly as
// the firmware wrote it.
func Describe(line protocol.Line) (Kind, string) {
	switch line.Kind {
	case protocol.KindAck:
		if line.Ack.OK {
			return KindOK, line.Ack.Cmd
		}
		return KindError, line.Ack.Cmd + ": " + line.Ack.Error
	case protocol.KindStatus:
		return KindOK, describeStatus(line.Status)
	case protocol.KindPatterns:
		return KindOK, "patterns: " + strings.Join(line.Patterns, ", ")
	case protocol.KindCalibrate:
		return describeCalibrate(line.Calibrate)
	case protocol.KindMotion:
		return KindMotion, describeMotion(line.Motion)
	}
	return KindFirmware, line.Raw
}

func describeStatus(s *protocol.Status) string {
	parts := []string{
		"status " + s.ID,
		s.Pattern,
		fmt.Sprintf("brightness %d/%d", s.Brightness, s.MaxBrightness),
	}
	if layout, ok := s.Layout(); ok {
		parts = append(parts, fmt.Sprintf("%d LEDs, toe %d, heel %d", layout.LEDs, layout.Toe, layout.Heel))
	}
	return strings.Join(parts, " · ")
}

func describeCalibrate(c *protocol.Calibrate) (Kind, string) {
	text := "calibrate " + c.Pose + ": " + c.State
	switch c.State {
	case "failed":
		return KindError, text + ", " + c.Reason
	case "ok":
		return KindOK, fmt.Sprintf("%s, %.1f°", text, c.AngleDeg)
	}
	return KindInfo, text
}

func describeMotion(m *protocol.Motion) string {
	text := fmt.Sprintf("tilt %+.2f · angle %.1f° · accel %.1f · peak %.1f · gyro %.2f",
		m.Tilt, m.AngleDeg, m.Accel, m.AccelPeak, m.Gyro)
	if m.Stomp {
		text += fmt.Sprintf(" · stomp %.2f", m.Strength)
	}
	return text
}
