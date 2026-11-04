package link

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

const statusLine = `{"t":"status","proto":2,"id":"3ED8","leds":94,"toe":86,"heel":48}`

func TestAwaitStatusSkipsLogsAndAcksToFindTheReply(t *testing.T) {
	fake := NewFake()
	fake.Script("status", "[firewalker] stomp -> trail (2 active)", `{"t":"ack","cmd":"debug","ok":true}`, statusLine)

	status, err := AwaitStatus(context.Background(), fake, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if status.ID != "3ED8" {
		t.Fatalf("got %+v", status)
	}
}

// A bench build or a board stuck in a bootloader says nothing back. That's an ordinary
// answer here, not a failure to report loudly.
func TestAwaitStatusGivesUpWithNoReply(t *testing.T) {
	fake := NewFake()
	fake.Push("[imu] tilt=0.05")

	_, err := AwaitStatus(context.Background(), fake, 30*time.Millisecond)
	if !errors.Is(err, ErrNoReply) {
		t.Fatalf("got %v, want ErrNoReply", err)
	}
	if sent := fake.Sent(); len(sent) == 0 || sent[0] != "status" {
		t.Fatalf("sent %v, want a status request", sent)
	}
}

// A command sent the moment the port opens can land before the board is listening, so
// the request repeats within the timeout instead of waiting out the whole thing.
func TestAwaitStatusAsksAgainIfTheFirstRequestIsLost(t *testing.T) {
	fake := NewFake()
	fake.ScriptNth("status", 2, statusLine)

	status, err := AwaitStatus(context.Background(), fake, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if status.ID != "3ED8" {
		t.Fatalf("got %+v", status)
	}
}

func TestAwaitStatusStopsWhenTheLinkEnds(t *testing.T) {
	fake := NewFake()
	fake.Close()
	if _, err := AwaitStatus(context.Background(), fake, time.Second); !errors.Is(err, ErrNoReply) {
		t.Fatalf("got %v, want ErrNoReply", err)
	}
}

// collector records Follow's events so a test can wait for one.
type collector struct {
	mu     sync.Mutex
	events []Event
}

func (c *collector) emit(e Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, e)
}

func (c *collector) lines() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var lines []string
	for _, e := range c.events {
		if e.Kind == EventLine {
			lines = append(lines, e.Line)
		}
	}
	return lines
}

func (c *collector) count(kind EventKind) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	total := 0
	for _, e := range c.events {
		if e.Kind == kind {
			total++
		}
	}
	return total
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

// A board drops off USB for a moment after an upload resets it, and a boot can be
// unplugged and replugged while someone watches its logs. Following has to ride through
// both and pick the stream back up.
func TestFollowReconnectsWhenALinkDrops(t *testing.T) {
	first, second := NewFake(), NewFake()
	var opens int
	var mu sync.Mutex
	open := func() (Transport, error) {
		mu.Lock()
		defer mu.Unlock()
		opens++
		switch opens {
		case 1:
			return nil, errors.New("not back yet")
		case 2:
			return first, nil
		default:
			return second, nil
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := &collector{}
	done := make(chan struct{})
	go func() {
		Follow(ctx, open, time.Millisecond, events.emit)
		close(done)
	}()

	waitFor(t, "the first connection", func() bool { return events.count(EventConnected) == 1 })
	first.Push("before")
	waitFor(t, "the first line", func() bool { return len(events.lines()) == 1 })
	first.Close()
	waitFor(t, "the drop", func() bool { return events.count(EventDisconnected) >= 1 })
	waitFor(t, "the reconnect", func() bool { return events.count(EventConnected) == 2 })
	second.Push("after")
	waitFor(t, "the second line", func() bool { return len(events.lines()) == 2 })

	if got := events.lines(); !slices.Equal(got, []string{"before", "after"}) {
		t.Fatalf("lines = %v", got)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Follow didn't stop when its context ended")
	}
	if !second.Closed() {
		t.Fatal("Follow should close the link it's holding when it stops")
	}
}

func TestLineSplitterHandlesEveryLineEnding(t *testing.T) {
	var got []string
	splitter := NewLineSplitter(func(line string) { got = append(got, line) })
	splitter.Write([]byte("one\r\ntwo\nthr"))
	splitter.Write([]byte("ee\rfour"))
	if want := []string{"one", "two", "three"}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	splitter.Flush()
	if want := []string{"one", "two", "three", "four"}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
