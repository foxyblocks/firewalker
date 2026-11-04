// Package boards finds the MG24s plugged in over USB and picks the one a command may
// touch. A board's USB serial number is what identifies it: it stays the same for a
// given board, while the port name can change between connections. cache.go remembers
// what each board last reported, keyed by that serial.
//
// Select holds the rule that matters most here: never guess. Flashing the wrong shoe
// costs real time, so an ambiguous choice is an error, never a pick.
package boards

import (
	"errors"
	"fmt"

	"go.bug.st/serial/enumerator"
)

// The XIAO MG24's onboard debug probe, which is also its USB serial port.
const (
	usbVID = "2886"
	usbPID = "0062"
)

// ErrNoBoards means no MG24 is visible on USB at all. Its message is the advice for the
// most common cause: a charge-only cable carries power but no data, so the boot lights
// up and still doesn't show here.
var ErrNoBoards = errors.New("No MG24 on USB. Try a data cable or a port without a hub.")

// Board is one connected MG24.
type Board struct {
	Port   string
	Serial string
}

// FromPorts keeps the MG24s out of everything the system reports. A board with no serial
// number is dropped, since there would be no safe way to name it to an upload.
func FromPorts(ports []*enumerator.PortDetails) []Board {
	var boards []Board
	for _, p := range ports {
		if p.IsUSB && p.VID == usbVID && p.PID == usbPID && p.SerialNumber != "" {
			boards = append(boards, Board{Port: p.Name, Serial: p.SerialNumber})
		}
	}
	return boards
}

// Discover lists the MG24s connected right now. It only asks the operating system, so
// it's quick enough to poll for plug and unplug, and it opens no ports.
func Discover() ([]Board, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return nil, fmt.Errorf("discover MG24 boards: %w", err)
	}
	return FromPorts(ports), nil
}

// Select picks the one board a test may flash. It never guesses: with several boards
// connected and no selection, or a selection matching nothing, it fails rather than
// risk programming a different shoe.
func Select(boards []Board, port, serial string) (Board, error) {
	if len(boards) == 0 {
		return Board{}, ErrNoBoards
	}
	var matches []Board
	for _, b := range boards {
		if (port == "" || port == b.Port) && (serial == "" || serial == b.Serial) {
			matches = append(matches, b)
		}
	}
	if len(matches) == 0 {
		return Board{}, fmt.Errorf("no matching MG24 found; check --port/--serial")
	}
	if len(matches) > 1 {
		return Board{}, fmt.Errorf("found %d MG24 boards; select one with --port or --serial", len(matches))
	}
	return matches[0], nil
}
