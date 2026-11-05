// Package link is the line-by-line conversation with a boot: send a command, receive
// lines. Screens and subcommands only see Transport, so they don't care that USB
// carries it today, and tests swap in a Fake with no board attached. Sorting those lines
// into replies and logs is internal/protocol's job.
//
// Two helpers cover what callers need most: AwaitStatus asks a boot about itself, and
// Follow stays attached to a board through resets and replugs.
package link

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"go.bug.st/serial"

	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/protocol"
)

// Baud must match SERIAL_BAUD in include/config.h.
const Baud = 115200

// ErrNoReply means nothing answered `status` in time. That's normal for a bench or
// imu_debug build, which don't run the remote, so callers fall back rather than fail.
var ErrNoReply = errors.New("no reply to status")

// Transport is an open line-based connection to a boot.
type Transport interface {
	// Send writes one command. The newline is added for you.
	Send(line string) error
	// Lines delivers each line from the board, without its line ending. The channel
	// closes when the connection ends, whether by Close or by an unplugged board.
	Lines() <-chan string
	// Close ends the connection and leaves the board running. It's safe to call twice.
	Close() error
}

// AwaitStatus asks a boot for its status and waits for the reply, skipping any logs and
// acks in between. The request repeats during the wait, because a command sent the
// moment a port opens can land before the board is listening.
func AwaitStatus(ctx context.Context, t Transport, timeout time.Duration) (*protocol.Status, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	resend := time.NewTicker(min(timeout/3, 300*time.Millisecond))
	defer resend.Stop()

	_ = t.Send("status")
	lines := t.Lines()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return nil, ErrNoReply
		case <-resend.C:
			_ = t.Send("status")
		case raw, ok := <-lines:
			if !ok {
				return nil, ErrNoReply
			}
			if line := protocol.Classify(raw); line.Kind == protocol.KindStatus {
				return line.Status, nil
			}
		}
	}
}

// QueryStatus opens a port just long enough to ask for status. A port something else is
// holding comes back as an error, which callers treat like no reply.
func QueryStatus(ctx context.Context, port string, timeout time.Duration) (*protocol.Status, error) {
	t, err := OpenSerial(port)
	if err != nil {
		return nil, err
	}
	defer t.Close()
	return AwaitStatus(ctx, t, timeout)
}

// ForBoard returns an Opener that finds a board by USB serial each time, because its
// port name can change when it reconnects.
func ForBoard(serial string) Opener {
	return func() (Transport, error) {
		connected, err := boards.Discover()
		if err != nil {
			return nil, err
		}
		for _, b := range connected {
			if b.Serial == serial {
				return OpenSerial(b.Port)
			}
		}
		return nil, fmt.Errorf("%s isn't on USB", serial)
	}
}

// EventKind says what Follow just saw.
type EventKind int

const (
	EventConnected    EventKind = iota // Event.Link is ready for Send
	EventLine                          // Event.Line arrived
	EventDisconnected                  // the connection dropped; Follow is retrying
	EventOpenFailed                    // Event.Err says why; Follow is retrying
)

// Event is one thing that happened while following a board.
type Event struct {
	Kind EventKind
	Line string
	Link Transport
	Err  error
}

// Opener makes a fresh connection. Follow calls it again after each drop.
type Opener func() (Transport, error)

// Follow stays attached to a board until ctx ends, calling emit for each event from
// this one goroutine, and closes the connection on the way out. A board drops off USB
// for a moment when an upload resets it, and a boot can be replugged while someone is
// watching its logs, so a lost connection means trying again every retry rather than
// giving up.
func Follow(ctx context.Context, open Opener, retry time.Duration, emit func(Event)) {
	for ctx.Err() == nil {
		t, err := open()
		if err != nil {
			emit(Event{Kind: EventOpenFailed, Err: err})
			sleep(ctx, retry)
			continue
		}
		emit(Event{Kind: EventConnected, Link: t})
		pump(ctx, t, emit)
		t.Close()
		if ctx.Err() != nil {
			return
		}
		emit(Event{Kind: EventDisconnected})
		sleep(ctx, retry)
	}
}

// pump delivers a connection's lines until it drops or ctx ends.
func pump(ctx context.Context, t Transport, emit func(Event)) {
	lines := t.Lines()
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-lines:
			if !ok {
				return
			}
			emit(Event{Kind: EventLine, Line: line})
		}
	}
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

// serialLink is a Transport over a USB serial port.
type serialLink struct {
	port  serial.Port
	lines chan string
	done  chan struct{}
	once  sync.Once
}

// OpenSerial opens a board's USB port at the firmware's baud rate. Anything the system
// buffered before now is dropped, so the first line read is a fresh one.
func OpenSerial(port string) (Transport, error) {
	opened, err := serial.Open(port, &serial.Mode{BaudRate: Baud})
	if err != nil {
		return nil, err
	}
	// A read timeout lets the read loop notice Close without waiting for the board to
	// say something.
	if err := opened.SetReadTimeout(100 * time.Millisecond); err != nil {
		opened.Close()
		return nil, err
	}
	_ = opened.ResetInputBuffer()
	l := &serialLink{port: opened, lines: make(chan string, 256), done: make(chan struct{})}
	go l.readLoop()
	return l, nil
}

func (l *serialLink) Send(line string) error {
	_, err := l.port.Write([]byte(line + "\n"))
	return err
}

func (l *serialLink) Lines() <-chan string { return l.lines }

func (l *serialLink) Close() error {
	var err error
	l.once.Do(func() {
		close(l.done)
		err = l.port.Close()
	})
	return err
}

// readLoop splits the port's bytes into lines until the port fails or closes, then
// closes the channel so readers know the connection ended.
func (l *serialLink) readLoop() {
	defer close(l.lines)
	splitter := NewLineSplitter(func(line string) {
		select {
		case l.lines <- line:
		case <-l.done:
		}
	})
	buffer := make([]byte, 1024)
	for {
		n, err := l.port.Read(buffer)
		if n > 0 {
			splitter.Write(buffer[:n])
		}
		if err != nil {
			return
		}
		select {
		case <-l.done:
			return
		default:
		}
	}
}
