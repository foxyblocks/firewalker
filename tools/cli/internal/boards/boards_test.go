package boards

import (
	"slices"
	"strings"
	"testing"
)

const deviceList = `[
  {"port": "/dev/cu.debug-console", "description": "n/a", "hwid": "n/a"},
  {"port": "/dev/cu.usbmodem111", "description": "Other", "hwid": "USB VID:PID=239A:80F1 SER=FEATHER LOCATION=1-1"},
  {"port": "/dev/cu.usbmodem572C60FA3", "description": "XIAO", "hwid": "USB VID:PID=2886:0062 SER=572C60FA LOCATION=2-1"},
  {"port": "/dev/cu.usbmodemAAAA1", "description": "XIAO", "hwid": "USB VID:PID=2886:0062 SER=AAAA LOCATION=2-2"}
]`

func TestParseListKeepsOnlyMG24Boards(t *testing.T) {
	boards, err := ParseList([]byte(deviceList))
	if err != nil {
		t.Fatal(err)
	}
	want := []Board{{"/dev/cu.usbmodem572C60FA3", "572C60FA"}, {"/dev/cu.usbmodemAAAA1", "AAAA"}}
	if !slices.Equal(boards, want) {
		t.Fatalf("got %v, want %v", boards, want)
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
		{name: "no boards fails", wantErr: "no matching"},
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
