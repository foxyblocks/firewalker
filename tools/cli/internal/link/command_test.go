package link_test

import (
	"context"
	"testing"
	"time"

	"firewalker/cli/internal/link"
)

func TestCommandWaitsForItsOwnAcknowledgment(t *testing.T) {
	port := link.NewFake()
	defer port.Close()
	port.Script("identify", `{"t":"ack","cmd":"audio","ok":true}`, `{"t":"ack","cmd":"identify","ok":true}`)
	if err := link.Command(context.Background(), port, "identify", time.Second); err != nil {
		t.Fatal(err)
	}
	port.Script("debug on", `{"t":"ack","cmd":"debug","ok":false,"error":"unavailable"}`)
	if err := link.Command(context.Background(), port, "debug on", time.Second); err == nil {
		t.Fatal("a rejected command must fail")
	}
}
