package main

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

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

// Nobody can press keys in a pipe, so bare `./cli` has to print help there rather than
// try to open a full-screen app. Tests run with no terminal, which is exactly that case.
func TestBareCommandPrintsHelpWithoutATerminal(t *testing.T) {
	out, err := run(t)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Usage:") || !strings.Contains(out, "flow") || !strings.Contains(out, "app") {
		t.Fatalf("got %q", out)
	}
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

// The TUI shows a command for every test so that anything done by hand can be scripted.
// That's only true if pasting it runs the same test, so each of these goes through the
// real flag parser and has to come back equal.
func TestPreviewedCommandsParseBackToTheSameTest(t *testing.T) {
	saved := bench.StripLayout{Pixels: 94, Toe: 86, Heel: 48}
	base := func(test int) (*bench.Options, *bench.Config) {
		return &bench.Options{Pixels: 94, Brightness: 16},
			&bench.Config{Name: bench.TestNames[test], Test: test, Toe: 86, Heel: 48, Lit: -1, Color: "cycle", Interval: 500 * time.Millisecond}
	}
	tests := []struct {
		name   string
		test   int
		mutate func(*bench.Options, *bench.Config)
	}{
		{"simulated flow", bench.TestFlow, func(_ *bench.Options, c *bench.Config) { c.Tilt, c.StompEvery = -0.5, 2*time.Second }},
		{"flow with motion and logs", bench.TestFlow, func(_ *bench.Options, c *bench.Config) { c.Motion, c.LogMotion = true, true }},
		{"edited layout", bench.TestFlow, func(o *bench.Options, c *bench.Config) { o.Pixels, c.Toe, c.Heel = 90, 10, 60 }},
		{"bright flow", bench.TestFlow, func(o *bench.Options, _ *bench.Config) { o.Brightness = 40 }},
		{"timed fire-trail", bench.TestFireTrail, func(_ *bench.Options, c *bench.Config) { c.StompEvery = time.Second }},
		{"fire-trail with its timer off", bench.TestFireTrail, func(_ *bench.Options, c *bench.Config) { c.StompEvery = 0 }},
		{"fire-trail from the toe", bench.TestFireTrail, func(_ *bench.Options, c *bench.Config) { c.Tilt, c.StompEvery = 1, time.Second }},
		{"fire-trail on motion", bench.TestFireTrail, func(_ *bench.Options, c *bench.Config) { c.Motion = true }},
		{"fixed color", bench.TestColor, func(_ *bench.Options, c *bench.Config) { c.Color, c.Lit = "#ff8000", 10 }},
		{"slow cycle", bench.TestColor, func(_ *bench.Options, c *bench.Config) { c.Interval = 2 * time.Second }},
		{"off", bench.TestOff, func(*bench.Options, *bench.Config) {}},
		{"named board", bench.TestFlow, func(o *bench.Options, _ *bench.Config) { o.Serial = "99C817E5" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			wantO, wantC := base(test.test)
			test.mutate(wantO, wantC)
			if !wantC.IsPattern() {
				wantC.Toe, wantC.Heel = -1, -1
			}
			if err := bench.Validate(wantO, wantC); err != nil {
				t.Fatal(err)
			}

			var gotO *bench.Options
			var gotC *bench.Config
			cmd := newCommandWith(func(_ context.Context, cmd *cobra.Command, o *bench.Options, c *bench.Config) error {
				// What runTest would do: a command with no --pixels gets the boot's layout.
				if !cmd.Flag("pixels").Changed {
					if c.IsPattern() {
						bench.ApplyLayout(o, c, saved)
					} else {
						o.Pixels = saved.Pixels
					}
				}
				gotO, gotC = o, c
				return bench.Validate(o, c)
			})
			args := bench.Args(wantO, wantC, saved)
			cmd.SetArgs(args)
			if err := cmd.ExecuteContext(context.Background()); err != nil {
				t.Fatalf("%v: %v", args, err)
			}
			gotO.RepoRoot = ""
			if *gotO != *wantO {
				t.Errorf("%v\noptions: got %+v, want %+v", args, *gotO, *wantO)
			}
			if *gotC != *wantC {
				t.Errorf("%v\nconfig: got %+v, want %+v", args, *gotC, *wantC)
			}
		})
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
