// Package webapp runs the phone remote in a browser on this computer, for `./cli web`. It
// drives the same bun scripts as app/README.md: install, build, then serve.
//
// Everything stays on one address, http://localhost:5173. A browser keeps a site's data
// and permissions per origin, which includes the port, so the boot labels (saved in
// localStorage) and Web Bluetooth permissions someone already has there would vanish on
// any other port. That's why a taken port is an error here rather than a reason to pick
// another one.
package webapp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"firewalker/cli/internal/proc"
	"firewalker/cli/internal/theme"
)

// Port matches the dev server's port in app/vite.config.ts, so `bun run dev` and this tool
// share one origin.
const Port = 5173

// How long the server gets to start answering before the browser opens anyway.
const readyTimeout = 30 * time.Second

// Options describe one run. RepoRoot is the repository root, which holds app/.
type Options struct {
	RepoRoot  string
	Dev       bool // serve from source with hot reload, instead of building first
	Fake      bool // open with pretend boots
	NoOpen    bool // print the address instead of opening a browser
	BuildOnly bool // build and stop
}

// Check refuses a combination where a flag would quietly do nothing.
func (o Options) Check() error {
	if o.BuildOnly {
		for flag, set := range map[string]bool{"--dev": o.Dev, "--fake": o.Fake, "--no-open": o.NoOpen} {
			if set {
				return fmt.Errorf("--build-only doesn't serve the app, so %s doesn't apply", flag)
			}
		}
	}
	return nil
}

// URL is the address to open. Pretend boots start already labeled, so the page goes
// straight to the remote without a Find boots step that has nothing real to find.
func (o Options) URL() string {
	url := fmt.Sprintf("http://localhost:%d", Port)
	if o.Fake {
		url += "/?boot=fake&paired=1"
	}
	return url
}

// Step is one bun command.
type Step struct{ Args []string }

func (s Step) String() string { return "bun " + strings.Join(s.Args, " ") }

// Plan is what a run does, in order: Setup steps that have to succeed, then Serve, which
// runs until it's stopped. Serve is nil when there's nothing to serve.
type Plan struct {
	Dir   string
	Setup []Step
	Serve *Step
}

// Plan works out the commands for these options. `bun run`, never bunx, because a global
// bunx can pick up an older Node than the app needs (see app/README.md).
func (o Options) Plan() Plan {
	plan := Plan{Dir: filepath.Join(o.RepoRoot, "app"), Setup: []Step{{[]string{"install"}}}}
	switch {
	case o.Dev:
		plan.Serve = &Step{[]string{"run", "dev", "--strictPort"}}
	case o.BuildOnly:
		plan.Setup = append(plan.Setup, Step{[]string{"run", "build"}})
	default:
		plan.Setup = append(plan.Setup, Step{[]string{"run", "build"}})
		plan.Serve = &Step{[]string{"run", "vite", "preview", "--port", strconv.Itoa(Port), "--strictPort"}}
	}
	return plan
}

// Run carries out the plan and blocks until ctx ends, which stops the server and counts
// as a normal finish. A failed step stops there, with bun's own output above it.
func Run(ctx context.Context, o Options, th *theme.Theme, stdout, stderr io.Writer) error {
	if _, err := exec.LookPath("bun"); err != nil {
		return errors.New("bun is required to build the web app. Install it from https://bun.sh")
	}
	plan := o.Plan()
	// Checking first means a taken port fails right away, not after a whole build.
	if plan.Serve != nil {
		if err := checkPort(Port); err != nil {
			return err
		}
	}

	for _, step := range plan.Setup {
		fmt.Fprintln(stdout, th.Bold.Render(step.String()))
		if err := command(ctx, plan.Dir, step, stdout, stderr).Run(); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("%s failed; its errors are above: %w", step, err)
		}
	}
	if plan.Serve == nil {
		return nil
	}

	fmt.Fprintln(stdout, th.Bold.Render(plan.Serve.String()))
	server := command(ctx, plan.Dir, *plan.Serve, stdout, quietOnceStopped{ctx, stderr})
	if err := server.Start(); err != nil {
		return fmt.Errorf("%s couldn't start: %w", plan.Serve, err)
	}
	go announce(ctx, o, th, stdout)
	if err := server.Wait(); err != nil && ctx.Err() == nil {
		return fmt.Errorf("the web server stopped: %w", err)
	}
	return nil
}

// command prepares one bun step. It gets no stdin, because it runs in a process group of
// its own and would be frozen by the system if it tried to read the terminal.
func command(ctx context.Context, dir string, step Step, stdout, stderr io.Writer) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "bun", step.Args...)
	cmd.Dir = dir
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.WaitDelay = 3 * time.Second
	proc.StopGroupOnCancel(cmd)
	return cmd
}

// quietOnceStopped passes output along until ctx ends, then drops it. Bun reports a stopped
// script as `error: script "dev" was terminated by signal SIGTERM`, which would make every
// Ctrl-C look like a failure.
type quietOnceStopped struct {
	ctx context.Context
	out io.Writer
}

func (q quietOnceStopped) Write(data []byte) (int, error) {
	if q.ctx.Err() != nil {
		return len(data), nil
	}
	return q.out.Write(data)
}

// checkPort fails if something is already answering on the port. It connects rather than
// trying to listen, because Vite may be on the IPv6 localhost, where a listen on the IPv4
// one would succeed anyway.
func checkPort(port int) error {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 500*time.Millisecond)
	if err != nil {
		return nil
	}
	conn.Close()
	return fmt.Errorf("localhost:%d is already in use, maybe by `bun run dev` or another `./cli web`. Stop it and try again", port)
}

// announce waits for the server to answer, then says where it is and opens the browser.
func announce(ctx context.Context, o Options, th *theme.Theme, stdout io.Writer) {
	if !waitForServer(ctx, o.URL()) {
		return
	}
	url := o.URL()
	fmt.Fprintln(stdout, th.Accent.Render("Running at "+url)+th.Dim.Render(". Ctrl-C stops the server."))
	if o.NoOpen {
		return
	}
	opener, ok := openCommand(runtime.GOOS, url)
	if !ok {
		return
	}
	if err := exec.CommandContext(ctx, opener[0], opener[1:]...).Run(); err != nil && ctx.Err() == nil {
		fmt.Fprintln(stdout, th.Dim.Render("Couldn't open a browser, so open that address yourself: "+err.Error()))
	}
}

func waitForServer(ctx context.Context, url string) bool {
	client := http.Client{Timeout: time.Second}
	deadline := time.Now().Add(readyTimeout)
	for time.Now().Before(deadline) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return false
		}
		if response, err := client.Do(request); err == nil {
			response.Body.Close()
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(200 * time.Millisecond):
		}
	}
	return false
}

// openCommand is how to open a URL on each system. With no known opener, the printed
// address is enough.
func openCommand(goos, url string) ([]string, bool) {
	switch goos {
	case "darwin":
		return []string{"open", url}, true
	case "linux":
		return []string{"xdg-open", url}, true
	}
	return nil, false
}
