package link

import (
	"errors"
	"sync"
)

// Fake is a Transport with no board behind it. Tests push lines at it and script its
// replies, which is what lets every screen run without hardware.
type Fake struct {
	mu      sync.Mutex
	lines   chan string
	closed  bool
	sent    []string
	replies map[string][]scriptedReply
	counts  map[string]int
}

type scriptedReply struct {
	nth   int // 0 answers every time; otherwise only the nth send of this command
	lines []string
}

// NewFake returns a Fake that stays silent until scripted.
func NewFake() *Fake {
	return &Fake{
		lines:   make(chan string, 1024),
		replies: map[string][]scriptedReply{},
		counts:  map[string]int{},
	}
}

// Script makes every Send of command produce these lines.
func (f *Fake) Script(command string, lines ...string) { f.ScriptNth(command, 0, lines...) }

// ScriptNth makes only the nth Send of command produce these lines, counting from 1.
func (f *Fake) ScriptNth(command string, nth int, lines ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replies[command] = append(f.replies[command], scriptedReply{nth, lines})
}

// Push delivers a line as if the board had just said it.
func (f *Fake) Push(line string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.lines <- line
	}
}

// Sent lists every command received so far, in order.
func (f *Fake) Sent() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.sent...)
}

// Closed reports whether the connection has been closed.
func (f *Fake) Closed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// Send records the command and delivers any scripted reply.
func (f *Fake) Send(line string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return errors.New("link closed")
	}
	f.sent = append(f.sent, line)
	f.counts[line]++
	for _, reply := range f.replies[line] {
		if reply.nth == 0 || reply.nth == f.counts[line] {
			for _, l := range reply.lines {
				f.lines <- l
			}
		}
	}
	return nil
}

// Lines delivers pushed and scripted lines.
func (f *Fake) Lines() <-chan string { return f.lines }

// Close ends the connection, like an unplugged board.
func (f *Fake) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.closed = true
		close(f.lines)
	}
	return nil
}
