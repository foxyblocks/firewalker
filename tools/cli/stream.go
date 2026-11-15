// Post-flash streaming: after `./cli app --debug` and friends, stay attached to the
// board and print what it says until Ctrl-C, which closes the port and leaves the
// board running. People get the log's colors and times; anything else, such as a
// pipe into a script, gets the board's raw lines. In a terminal a typed line goes
// to the board, so commands like `debug on` still work here.
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

// streamBoard blocks until ctx ends. Only the event loop below writes output and
// sends commands, so typed input and connection callbacks can't race each other.
func streamBoard(ctx context.Context, out io.Writer, th *theme.Theme, serial string) {
	fmt.Fprintf(out, "Streaming from %s. Ctrl-C stops the stream and leaves the board running.\n", serial)
	input := make(chan string)
	inputCtx, stopInput := context.WithCancel(ctx)
	defer stopInput()
	if term.IsTerminal(int(os.Stdin.Fd())) {
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

	// link.Follow reopens the port through resets and replugs. Wait for it to
	// finish on the way out so the port is closed before the command returns.
	events := make(chan link.Event, 64)
	followCtx, stopFollow := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer close(events)
		link.Follow(followCtx, link.ForBoard(serial), 500*time.Millisecond, func(event link.Event) {
			select {
			case events <- event:
			case <-followCtx.Done():
			}
		})
	}()
	defer func() {
		stopFollow()
		<-done
	}()

	var current link.Transport
	lastProblem := ""
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-input:
			if !ok {
				input = nil
				continue
			}
			if current != nil && line != "" {
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
				// The board is usually gone for a moment after an upload, so this repeats
				// until it returns. One line per distinct reason is enough.
				if message := event.Err.Error(); message != lastProblem && ctx.Err() == nil {
					lastProblem = message
					note("Waiting for " + serial + ": " + message)
				}
			}
		}
	}
}
