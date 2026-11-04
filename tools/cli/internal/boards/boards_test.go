package boards

import (
	"slices"
	"strings"
	"testing"

	"go.bug.st/serial/enumerator"
)

func TestFromPortsKeepsOnlyMG24Boards(t *testing.T) {
	ports := []*enumerator.PortDetails{
		{Name: "/dev/cu.Bluetooth-Incoming-Port"},
		{Name: "/dev/cu.usbmodem111", IsUSB: true, VID: "239A", PID: "80F1", SerialNumber: "FEATHER"},
		{Name: "/dev/cu.usbmodem572C60FA3", IsUSB: true, VID: "2886", PID: "0062", SerialNumber: "572C60FA"},
		{Name: "/dev/cu.usbmodemNOSERIAL", IsUSB: true, VID: "2886", PID: "0062"},
		{Name: "/dev/ttyACM0", IsUSB: true, VID: "2886", PID: "0062", SerialNumber: "AAAA"},
	}
	want := []Board{{"/dev/cu.usbmodem572C60FA3", "572C60FA"}, {"/dev/ttyACM0", "AAAA"}}
	if got := FromPorts(ports); !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSelectNeverGuesses(t *testing.T) {
	left := Board{"/dev/cu.left", "LEFT"}
	right := Board{"/dev/cu.right", "RIGHT"}
	tests := []struct {
		name         string
		boards       []Board
		port, serial string
		want         Board
		wantErr      string
	}{
		{name: "one board needs no selection", boards: []Board{left}, want: left},
		{name: "two boards refuse to guess", boards: []Board{left, right}, wantErr: "select one"},
		{name: "serial picks a board", boards: []Board{left, right}, serial: "RIGHT", want: right},
		{name: "port picks a board", boards: []Board{left, right}, port: "/dev/cu.left", want: left},
		{name: "unknown serial fails", boards: []Board{left, right}, serial: "NOPE", wantErr: "no matching"},
		{name: "a selection can't fall through to the other board", boards: []Board{left}, serial: "RIGHT", wantErr: "no matching"},
		{name: "no boards suggests a data cable", wantErr: "No MG24 on USB. Try a data cable or a port without a hub."},
		{name: "a selection with no boards gets the same hint", serial: "RIGHT", wantErr: "No MG24 on USB"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Select(test.boards, test.port, test.serial)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("got error %v, want it to mention %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}
