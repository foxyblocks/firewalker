package diagnostics

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
)

const ReplyTimeout = 1200 * time.Millisecond

// Session exclusively owns a boot's telemetry reader until Close. Connect asks
// for a fresh status and temporarily enables debug; Close restores the original
// state even after the caller's context is canceled. Saved settings are untouched.
type Session struct {
	Status       *protocol.Status
	transport    link.Transport
	changedDebug bool
	once         sync.Once
	closeErr     error
	mu           sync.Mutex
	closed       bool
}

// Connect validates the live boot ID before enabling telemetry. A cached ID can
// select hardware for recovery, but it cannot authorize observing a different
// identity if the running firmware now reports something else.
func Connect(ctx context.Context, expectedID string, open link.Opener) (*Session, error) {
	transport, err := open()
	if err != nil {
		return nil, err
	}
	status, err := link.AwaitStatus(ctx, transport, ReplyTimeout)
	if err != nil {
		transport.Close()
		return nil, err
	}
	if expectedID != "" && status.ID != expectedID {
		transport.Close()
		return nil, fmt.Errorf("expected boot %s, received %s; run ./cli list again", expectedID, status.ID)
	}
	session := &Session{Status: status, transport: transport, changedDebug: !status.Debug}
	if session.changedDebug {
		if err := link.Command(ctx, transport, "debug on", ReplyTimeout); err != nil {
			return nil, errors.Join(err, session.Close())
		}
	}
	return session, nil
}

// Next returns one classified line. A closed port is an error, not a quiet
// microphone, so disconnects cannot turn into misleading acoustic FAIL results.
func (s *Session) Next(ctx context.Context) (protocol.Line, error) {
	select {
	case <-ctx.Done():
		return protocol.Line{}, ctx.Err()
	case raw, ok := <-s.transport.Lines():
		if !ok {
			return protocol.Line{}, fmt.Errorf("USB disconnected")
		}
		return protocol.Classify(raw), nil
	}
}

// Send is for live dashboard actions such as identify. Acknowledgments arrive
// through Next with the telemetry; it does not start a second port reader.
func (s *Session) Send(command string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("diagnostic session is closed")
	}
	return s.transport.Send(command)
}

// Close restores debug using its own bounded context, then releases USB even if
// restoration fails. It is safe to call again and returns any cleanup failure.
func (s *Session) Close() error {
	s.once.Do(func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.closed = true
		if s.changedDebug {
			ctx, cancel := context.WithTimeout(context.Background(), ReplyTimeout)
			defer cancel()
			s.closeErr = link.Command(ctx, s.transport, "debug off", ReplyTimeout)
		}
		s.closeErr = errors.Join(s.closeErr, s.transport.Close())
	})
	return s.closeErr
}
