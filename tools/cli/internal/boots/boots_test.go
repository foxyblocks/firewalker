package boots_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/boots"
	"firewalker/cli/internal/protocol"
)

func TestResolveBootIDsAndUSBSerialsWithoutSelectingTwice(t *testing.T) {
	connected := []boots.Boot{
		{ID: "3ED8", Serial: "USB-A", Port: "/dev/cu.a"},
		{ID: "3EB5", Serial: "USB-B", Port: "/dev/cu.b"},
	}
	selected, err := boots.Resolve(connected, []string{"3eb5", "USB-A", "3ED8"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || selected[0].ID != "3EB5" || selected[1].ID != "3ED8" {
		t.Fatalf("selected = %+v", selected)
	}
}

func TestResolveRejectsAnIncompleteOrAmbiguousSelection(t *testing.T) {
	connected := []boots.Boot{{ID: "AAAA", Serial: "one"}, {ID: "AAAA", Serial: "two"}}
	for _, names := range [][]string{{"one", "missing"}, {"AAAA"}} {
		selected, err := boots.Resolve(connected, names, false)
		if err == nil || len(selected) != 0 {
			t.Fatalf("%v selected %+v with error %v", names, selected, err)
		}
	}
	if _, err := boots.Resolve(connected, []string{"one"}, true); err == nil {
		t.Fatal("--all must not silently override a named boot")
	}
}

func TestInventoryKeepsARecoverableBoardAndRefreshesTheLiveID(t *testing.T) {
	cache := boards.OpenCache(filepath.Join(t.TempDir(), "boards.json"))
	if err := cache.Update("bench", func(r *boards.Record) { r.ID = "OLD1" }); err != nil {
		t.Fatal(err)
	}
	inventory := boots.Inventory{
		Cache: cache,
		Discover: func() ([]boards.Board, error) {
			return []boards.Board{{Serial: "bench", Port: "bench-port"}, {Serial: "app", Port: "app-port"}}, nil
		},
		Query: func(_ context.Context, port string) (*protocol.Status, error) {
			if port == "bench-port" {
				return nil, errors.New("no status reply")
			}
			return &protocol.Status{ID: "LIVE", Proto: 5}, nil
		},
	}
	connected, err := inventory.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(connected) != 2 || connected[0].ID != "LIVE" || connected[1].ID != "OLD1" || !connected[1].Remembered || connected[1].Problem == "" {
		t.Fatalf("connected = %+v", connected)
	}
	if record, _ := cache.Get("app"); record.ID != "LIVE" {
		t.Fatalf("live ID wasn't remembered: %+v", record)
	}
}
