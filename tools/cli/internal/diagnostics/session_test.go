package diagnostics_test

import (
	"context"
	"slices"
	"testing"

	"firewalker/cli/internal/diagnostics"
	"firewalker/cli/internal/link"
)

func TestSessionRestoresDebugAndClosesUSBWhenCaptureIsCanceled(t *testing.T) {
	port := link.NewFake()
	port.Script("status", `{"t":"status","id":"3EB5","proto":5,"sensor":"ok","debug":false}`)
	port.Script("debug on", `{"t":"ack","cmd":"debug","ok":true}`)
	port.Script("debug off", `{"t":"ack","cmd":"debug","ok":true}`)
	session, err := diagnostics.Connect(context.Background(), "3EB5", func() (link.Transport, error) { return port, nil })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := session.Next(ctx); err == nil {
		t.Fatal("canceled capture must stop")
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	if !port.Closed() || !slices.Equal(port.Sent(), []string{"status", "debug on", "debug off"}) {
		t.Fatalf("closed=%t, commands=%v", port.Closed(), port.Sent())
	}
}
