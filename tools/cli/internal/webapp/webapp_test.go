package webapp

import (
	"bytes"
	"context"
	"net"
	"slices"
	"strings"
	"testing"
)

func commandLines(steps []Step) []string {
	var lines []string
	for _, step := range steps {
		lines = append(lines, step.String())
	}
	return lines
}

func TestPlanBuildsThenServesByDefault(t *testing.T) {
	plan := Options{RepoRoot: "/repo"}.Plan()
	if want := []string{"bun install --frozen-lockfile", "bun install --cwd ../designer --frozen-lockfile", "bun run build"}; !slices.Equal(commandLines(plan.Setup), want) {
		t.Fatalf("setup = %v, want %v", commandLines(plan.Setup), want)
	}
	if plan.Serve == nil || plan.Serve.String() != "bun run vite preview --port 5173 --strictPort" {
		t.Fatalf("serve = %v", plan.Serve)
	}
	if plan.Dir != "/repo/app" {
		t.Fatalf("dir = %q", plan.Dir)
	}
}

// The dev server hot-reloads from source, so a build first would only waste time. It has
// to refuse a taken port rather than drift to 5174, because a different port is a
// different origin, with none of the boot labels or Bluetooth permissions.
func TestPlanForDevSkipsTheBuildAndStaysOnItsPort(t *testing.T) {
	plan := Options{RepoRoot: "/repo", Dev: true}.Plan()
	if want := []string{"bun install --frozen-lockfile", "bun install --cwd ../designer --frozen-lockfile"}; !slices.Equal(commandLines(plan.Setup), want) {
		t.Fatalf("setup = %v", commandLines(plan.Setup))
	}
	if plan.Serve == nil || plan.Serve.String() != "bun run dev --strictPort" {
		t.Fatalf("serve = %v", plan.Serve)
	}
}

func TestPlanForBuildOnlyServesNothing(t *testing.T) {
	plan := Options{RepoRoot: "/repo", BuildOnly: true}.Plan()
	if want := []string{"bun install --frozen-lockfile", "bun install --cwd ../designer --frozen-lockfile", "bun run build"}; !slices.Equal(commandLines(plan.Setup), want) {
		t.Fatalf("setup = %v", commandLines(plan.Setup))
	}
	if plan.Serve != nil {
		t.Fatalf("serve = %v", plan.Serve)
	}
}

func TestURLStaysOnTheOriginWithTheBootsLabels(t *testing.T) {
	if got := (Options{}).URL(); got != "http://localhost:5173" {
		t.Fatalf("got %q", got)
	}
	if got := (Options{Fake: true}).URL(); got != "http://localhost:5173/?boot=fake&paired=1" {
		t.Fatalf("got %q", got)
	}
}

func TestOptionsRefuseCombinationsThatWouldIgnoreAFlag(t *testing.T) {
	tests := []struct {
		name string
		opts Options
		want string
	}{
		{"nothing to build for dev", Options{Dev: true, BuildOnly: true}, "--dev"},
		{"no page to fake", Options{Fake: true, BuildOnly: true}, "--fake"},
		{"no page to open", Options{NoOpen: true, BuildOnly: true}, "--no-open"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.opts.Check(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got %v, want it to mention %s", err, test.want)
			}
		})
	}
	for _, fine := range []Options{{}, {Dev: true, Fake: true}, {NoOpen: true}, {BuildOnly: true}} {
		if err := fine.Check(); err != nil {
			t.Errorf("%+v: %v", fine, err)
		}
	}
}

func TestOpenCommandUsesEachSystemsOpener(t *testing.T) {
	const url = "http://localhost:5173"
	if got, ok := openCommand("darwin", url); !ok || !slices.Equal(got, []string{"open", url}) {
		t.Fatalf("darwin = %v, %t", got, ok)
	}
	if got, ok := openCommand("linux", url); !ok || !slices.Equal(got, []string{"xdg-open", url}) {
		t.Fatalf("linux = %v, %t", got, ok)
	}
	if _, ok := openCommand("plan9", url); ok {
		t.Fatal("an unknown system should just print the address")
	}
}

func TestCheckPortExplainsWhatToDoWhenItsTaken(t *testing.T) {
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	err = checkPort(port)
	if err == nil || !strings.Contains(err.Error(), "already in use") || !strings.Contains(err.Error(), "bun run dev") {
		t.Fatalf("got %v", err)
	}
	listener.Close()
	if err := checkPort(port); err != nil {
		t.Fatalf("a free port: %v", err)
	}
}

// Stopping the server is a normal finish, but bun reports it as an error. Real errors
// before that still have to get through.
func TestServerErrorsAreQuietOnceItIsBeingStopped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var out bytes.Buffer
	writer := quietOnceStopped{ctx, &out}

	writer.Write([]byte("port is broken\n"))
	cancel()
	n, err := writer.Write([]byte(`error: script "dev" was terminated by signal SIGTERM`))
	if err != nil || n == 0 {
		t.Fatalf("dropping output should still look like a successful write: %d, %v", n, err)
	}
	if got := out.String(); got != "port is broken\n" {
		t.Fatalf("got %q", got)
	}
}
