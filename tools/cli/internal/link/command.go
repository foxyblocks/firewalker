package link

import (
	"context"
	"fmt"
	"strings"
	"time"

	"firewalker/cli/internal/protocol"
)

// Command sends one protocol command and waits for its matching acknowledgment.
// Logs, telemetry, and unrelated replies may share the connection. It does not
// retry actions: a lost acknowledgment must not blink or change a boot twice.
// The caller owns this connection's reader while Command is waiting.
func Command(ctx context.Context, transport Transport, command string, timeout time.Duration) error {
	words := strings.Fields(command)
	if len(words) == 0 {
		return fmt.Errorf("empty USB command")
	}
	if err := transport.Send(command); err != nil {
		return err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return fmt.Errorf("no acknowledgment for %s", command)
		case raw, ok := <-transport.Lines():
			if !ok {
				return fmt.Errorf("USB disconnected while waiting for %s", command)
			}
			line := protocol.Classify(raw)
			if line.Kind != protocol.KindAck || line.Ack.Cmd != words[0] {
				continue
			}
			if !line.Ack.OK {
				return fmt.Errorf("%s rejected: %s", command, line.Ack.Error)
			}
			return nil
		}
	}
}
