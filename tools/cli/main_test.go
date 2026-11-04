package main

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"firewalker/cli/internal/bench"
	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/protocol"
)

func run(t *testing.T, args ...string) (string, error) {
	t.Helper()
	cmd := newCommand()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(append([]string{"--repo-root", "../.."}, args...))
	err := cmd.ExecuteContext(context.Background())
	return out.String(), err
}

func TestExplicitLayoutRunsInEitherOrderWithoutAnyBoard(t *testing.T) {
	out, err := run(t, "flow", "--pixels", "94", "--toe", "86", "--heel", "48", "--dry-run")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "pixels: 94") || !strings.Contains(out, "toe=86 heel=48") {
		t.Fatalf("got %q", out)
	}
	if !strings.Contains(out, "--pixels") {
		t.Fatalf("should say the layout came from flags: %q", out)
	}
}

func TestAppRefusesFlagsItWouldIgnore(t *testing.T) {
	for _, flag := range []string{"--pixels", "--brightness"} {
		if _, err := run(t, "app", flag, "20", "--dry-run"); err == nil || !strings.Contains(err.Error(), flag) {
			t.Errorf("app %s: got %v", flag, err)
		}
	}
}

func TestDebugNeedsAnUpload(t *testing.T) {
	for _, args := range [][]string{
		{"app", "--debug", "--build-only"},
		{"flow", "--debug", "--build-only", "--pixels", "94"},
	} {
		if _, err := run(t, args...); err == nil || !strings.Contains(err.Error(), "--debug") {
			t.Errorf("%v: got %v", args, err)
		}
	}
}

func saved(leds, toe, heel int) *protocol.Status {
	return &protocol.Status{Proto: 2, ID: "3ED8", LEDs: &leds, Toe: &toe, Heel: &heel}
}

func TestSavedLayoutPrefersWhatTheBootSaysAndRemembersIt(t *testing.T) {
	cache := boards.OpenCache(filepath.Join(t.TempDir(), "boards.json"))
	config := bench.StripLayout{Pixels: 160, Toe: 52, Heel: 132}
	target := boards.Board{Port: "/dev/cu.right", Serial: "99C817E5"}

	asked := ""
	finder := layoutFinder{cache: cache, query: func(_ context.Context, port string) (*protocol.Status, error) {
		asked = port
		return saved(94, 86, 48), nil
	}}
	got := finder.resolve(context.Background(), config, &target, "")
	if asked != target.Port {
		t.Fatalf("asked %q", asked)
	}
	if got.Layout != (bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}) || got.Source != bench.SourceBoot {
		t.Fatalf("got %+v", got)
	}
	if !strings.Contains(got.Note, "3ED8") {
		t.Fatalf("note = %q", got.Note)
	}

	// A later run finds a bench build on the board, which can't answer.
	finder.query = func(context.Context, string) (*protocol.Status, error) {
		return nil, errors.New("no reply")
	}
	got = finder.resolve(context.Background(), config, &target, "")
	if got.Layout != (bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}) || got.Source != bench.SourceRemembered {
		t.Fatalf("got %+v", got)
	}
	if !strings.Contains(got.Note, "3ED8") {
		t.Fatalf("note = %q", got.Note)
	}
}

func TestSavedLayoutFallsBackToConfigForAnUnknownBoard(t *testing.T) {
	cache := boards.OpenCache(filepath.Join(t.TempDir(), "boards.json"))
	config := bench.StripLayout{Pixels: 160, Toe: 52, Heel: 132}
	target := boards.Board{Port: "/dev/cu.left", Serial: "FBC116E9"}

	// Proto 1 answers, but has no layout to offer.
	finder := layoutFinder{cache: cache, query: func(context.Context, string) (*protocol.Status, error) {
		return &protocol.Status{Proto: 1, ID: "3EB5"}, nil
	}}
	got := finder.resolve(context.Background(), config, &target, "")
	if got.Layout != config || got.Source != bench.SourceConfig {
		t.Fatalf("got %+v", got)
	}
	if !strings.Contains(got.Note, "config.h") {
		t.Fatalf("note = %q", got.Note)
	}
	// Its id is still worth keeping for later.
	if record, _ := cache.Get("FBC116E9"); record.ID != "3EB5" {
		t.Fatalf("record = %+v", record)
	}
}

// A dry run with two boards connected has no single target, but a board named with
// --serial may still be remembered.
func TestSavedLayoutWithNoReachableBoardUsesTheNamedSerial(t *testing.T) {
	cache := boards.OpenCache(filepath.Join(t.TempDir(), "boards.json"))
	if err := cache.Update("99C817E5", func(r *boards.Record) {
		r.ID = "3ED8"
		r.Layout = &boards.SavedLayout{LEDs: 94, Toe: 86, Heel: 48}
	}); err != nil {
		t.Fatal(err)
	}
	finder := layoutFinder{cache: cache, query: func(context.Context, string) (*protocol.Status, error) {
		t.Fatal("no board to ask")
		return nil, nil
	}}
	config := bench.StripLayout{Pixels: 160, Toe: 52, Heel: 132}
	got := finder.resolve(context.Background(), config, nil, "99C817E5")
	if got.Source != bench.SourceRemembered || got.Layout.Pixels != 94 {
		t.Fatalf("got %+v", got)
	}
	if got = finder.resolve(context.Background(), config, nil, ""); got.Source != bench.SourceConfig {
		t.Fatalf("got %+v", got)
	}
}
