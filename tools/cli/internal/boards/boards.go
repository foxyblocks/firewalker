// Package boards finds the MG24s plugged in over USB and picks the one a command may
// touch. A board's USB serial number is what identifies it: it stays the same for a
// given board, while the port name can change between connections.
//
// Select holds the rule that matters most here: never guess. Flashing the wrong shoe
// costs real time, so an ambiguous choice is an error, never a pick.
package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// The XIAO MG24's onboard debug probe, which is also its USB serial port.
const usbID = "2886:0062"

// Board is one connected MG24.
type Board struct {
	Port   string
	Serial string
}

var serialPattern = regexp.MustCompile(`SER=([A-Za-z0-9_-]+)`)

// ParseList reads `pio device list --json-output`, keeping only MG24 boards.
func ParseList(data []byte) ([]Board, error) {
	var ports []struct {
		Port string `json:"port"`
		HWID string `json:"hwid"`
	}
	if err := json.Unmarshal(data, &ports); err != nil {
		return nil, fmt.Errorf("read board discovery: %w", err)
	}
	var boards []Board
	for _, p := range ports {
		if !strings.Contains(strings.ToLower(p.HWID), usbID) {
			continue
		}
		match := serialPattern.FindStringSubmatch(p.HWID)
		if match == nil {
			continue
		}
		boards = append(boards, Board{Port: p.Port, Serial: match[1]})
	}
	return boards, nil
}

// Discover lists the MG24s connected right now.
func Discover(ctx context.Context) ([]Board, error) {
	data, err := exec.CommandContext(ctx, "pio", "device", "list", "--serial", "--json-output").Output()
	if err != nil {
		return nil, fmt.Errorf("discover MG24 boards: %w", err)
	}
	return ParseList(data)
}

// Select picks the one board a test may flash. It never guesses: with several boards
// connected and no selection, or a selection matching nothing, it fails rather than
// risk programming a different shoe.
func Select(boards []Board, port, serial string) (Board, error) {
	var matches []Board
	for _, b := range boards {
		if (port == "" || port == b.Port) && (serial == "" || serial == b.Serial) {
			matches = append(matches, b)
		}
	}
	if len(matches) == 0 {
		return Board{}, fmt.Errorf("no matching MG24 found; connect it over USB or check --port/--serial")
	}
	if len(matches) > 1 {
		return Board{}, fmt.Errorf("found %d MG24 boards; select one with --port or --serial", len(matches))
	}
	return matches[0], nil
}
