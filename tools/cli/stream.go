// Post-flash streaming has the same human inactivity policy as the TUI. Incoming
// lines never renew it: an unattended log must release its USB port too. A terminal
// stays open while paused, and Enter reconnects; a noninteractive stream exits once
// idle because it has no user input that could wake it. The configured zero timeout
// keeps a deliberate long-running recording attached.
package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"golang.org/x/term"

	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
	"firewalker/cli/internal/theme"
)

// streamBoard closes the port on pause or exit. Only the event loop writes output
// and sends commands, so input and connection callbacks can't race each other.
func streamBoard(ctx context.Context, out io.Writer, th *theme.Theme, serial string, timeout time.Duration) {
	fmt.Fprintf(out, "Streaming from %s. Ctrl-C stops the stream and leaves the board running.\n", serial)
	input := make(chan string)
	interactive := term.IsTerminal(int(os.Stdin.Fd()))
	inputCtx, stopInput := context.WithCancel(ctx)
	defer stopInput()
	if interactive {
		go func() {
			defer close(input)
			scanner := bufio.NewScanner(os.Stdin)
			for scanner.Scan() {
				select {
				case input <- scanner.Text():
				case <-inputCtx.Done():
					return
				}
			}
		}()
	}

	note := func(text string) {
		if th.Colored() {
			fmt.Fprintln(out, th.Line(time.Now(), theme.KindInfo, text))
		} else {
			fmt.Fprintln(out, text)
		}
	}
	var current link.Transport
	var events <-chan link.Event
	var cancel context.CancelFunc
	var done <-chan struct{}
	stop := func() {
		if cancel != nil {
			cancel()
		}
		events, current = nil, nil
	}
	defer func() {
		stop()
		if done != nil {
			<-done
		}
	}()
	start := func() {
		followCtx, stopFollow := context.WithCancel(ctx)
		cancel = stopFollow
		next := make(chan link.Event, 64)
		finished := make(chan struct{})
		previous := done
		events, done = next, finished
		go func() {
			defer close(finished)
			defer close(next)
			// Closing is asynchronous. Wait before opening the same port again so a
			// quick wake can't collide with the connection being released.
			if previous != nil {
				select {
				case <-previous:
				case <-followCtx.Done():
					return
				}
			}
			link.Follow(followCtx, link.ForBoard(serial), 500*time.Millisecond, func(event link.Event) {
				select {
				case next <- event:
				case <-followCtx.Done():
				}
			})
		}()
	}
	start()
	var timer *time.Timer
	var deadline <-chan time.Time
	if timeout > 0 {
		timer = time.NewTimer(timeout)
		deadline = timer.C
		defer timer.Stop()
	}
	paused, lastProblem := false, ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-deadline:
			stop()
			paused = true
			lastProblem = "paused"
			deadline = nil
			if !interactive {
				return
			}
			note("Connection paused while idle. Press Enter to reconnect.")
		case line, ok := <-input:
			if !ok {
				input = nil
				continue
			}
			if timer != nil {
				timer.Reset(timeout)
				deadline = timer.C
			}
			if paused {
				paused = false
				start()
				note("Reconnecting. Repeat your command once attached.")
			} else if current != nil && line != "" {
				_ = current.Send(line)
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			switch event.Kind {
			case link.EventConnected:
				current = event.Link
				if lastProblem != "" {
					note("Attached to " + serial)
				}
				lastProblem = ""
			case link.EventLine:
				if !th.Colored() {
					fmt.Fprintln(out, event.Line)
					continue
				}
				kind, text := theme.Describe(protocol.Classify(event.Line))
				fmt.Fprintln(out, th.Line(time.Now(), kind, text))
			case link.EventDisconnected:
				current = nil
				lastProblem = "disconnected"
				note("Lost " + serial + ". Waiting for it to come back.")
			case link.EventOpenFailed:
				if message := event.Err.Error(); message != lastProblem && ctx.Err() == nil {
					lastProblem = message
					note("Waiting for " + serial + ": " + message)
				}
			}
		}
	}
}
