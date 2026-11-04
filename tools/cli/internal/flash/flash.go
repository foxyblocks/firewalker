// Package flash runs PlatformIO to build firmware and put it on one board. The
// subcommands and the TUI both go through Job, so they build the same command line and
// always name exactly one board to an upload. tools/pio/mg24_stack.py does the actual
// probe targeting on the other side of `--upload-port`.
//
// The TUI's stage line and pinned errors come from reading PlatformIO's output, with
// StageFromOutput and IsErrorLine. Only the exit code decides whether a job succeeded.
package flash

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"firewalker/cli/internal/proc"
)

// Build is a whole firmware the tool can flash, as opposed to a configured bench test.
type Build struct{ Name, Env, Description string }

// AppEnv is the PlatformIO environment for the shoe app.
const AppEnv = "final_app"

// Builds lists the whole-firmware flashes, with the app first since getting back to it
// is the usual reason to be here.
var Builds = []Build{
	{"App (final_app)", AppEnv, "Back to the app. Saved settings stay."},
	{"imu_debug", "imu_debug", "Raw motion log, tilt shown as brightness"},
	{"strip_test", "strip_test", "Cycle colors on every pixel"},
	{"strip_off", "strip_off", "Blank every pixel"},
}

// Job is one `pio run`.
type Job struct {
	RepoRoot string
	Env      string
	Serial   string   // the board to upload to; empty builds without uploading
	SrcFlags []string // bench test macros from bench.BuildFlags
}

// ErrNoPio means PlatformIO isn't installed or isn't on the PATH.
var ErrNoPio = errors.New("PlatformIO's pio command is required")

// Args is the pio command line. A job with no Serial can't upload at all, so nothing
// here can fall through to whichever board PlatformIO would find first.
func (j Job) Args() []string {
	args := []string{"run", "--project-dir", j.RepoRoot, "-e", j.Env}
	if j.Serial != "" {
		args = append(args, "-t", "upload", "--upload-port", j.Serial)
	}
	return args
}

// srcFlagsVar reaches only the firmware's own sources, so switching bench tests
// recompiles them without rebuilding the whole Silicon Labs core.
const srcFlagsVar = "PLATFORMIO_BUILD_SRC_FLAGS"

// Environ returns base with this job's bench flags set. A value already in the shell is
// always dropped, so an old test's flags can't leak into a whole-firmware build.
func (j Job) Environ(base []string) []string {
	env := make([]string, 0, len(base)+1)
	for _, entry := range base {
		if !strings.HasPrefix(entry, srcFlagsVar+"=") {
			env = append(env, entry)
		}
	}
	if len(j.SrcFlags) > 0 {
		env = append(env, srcFlagsVar+"="+strings.Join(j.SrcFlags, " "))
	}
	return env
}

// Run builds and, if the job names a board, uploads. It blocks until pio exits, and ctx
// stops it early. Canceling a job mid-upload can leave a board half-written, but a board
// always recovers by flashing again, since uploads go through the debug probe.
func (j Job) Run(ctx context.Context, base []string, stdout, stderr io.Writer) error {
	if _, err := exec.LookPath("pio"); err != nil {
		return fmt.Errorf("%w: %v", ErrNoPio, err)
	}
	cmd := exec.CommandContext(ctx, "pio", j.Args()...)
	cmd.Env = j.Environ(base)
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.WaitDelay = 3 * time.Second
	proc.StopGroupOnCancel(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pio run failed: %w", err)
	}
	return nil
}

// Stage is how far a flash has gotten.
type Stage int

const (
	StageIdle Stage = iota
	StageBuilding
	StageUploading
	StageRunning // the flash finished and the new firmware is on the board
	StageFailed
)

func (s Stage) String() string {
	switch s {
	case StageBuilding:
		return "building"
	case StageUploading:
		return "uploading"
	case StageRunning:
		return "running"
	case StageFailed:
		return "failed"
	}
	return "idle"
}

// StageFromOutput spots a line that marks a new stage in PlatformIO's output. ok is
// false for all the lines in between, which leave the stage where it was.
func StageFromOutput(line string) (stage Stage, ok bool) {
	switch {
	case strings.HasPrefix(line, "Configuring upload protocol"),
		strings.HasPrefix(line, "mg24 upload:"),
		strings.HasPrefix(line, "Uploading "),
		strings.Contains(line, "** Programming Started **"):
		return StageUploading, true
	case strings.HasPrefix(line, "Processing "),
		strings.HasPrefix(line, "Compiling "),
		strings.HasPrefix(line, "Linking "),
		strings.HasPrefix(line, "Building "):
		return StageBuilding, true
	}
	return 0, false
}

// IsErrorLine spots the output worth pinning on screen after a failed flash, so the
// reason stays readable once the rest has scrolled away. Progress lines are excluded,
// because plenty of firmware source files have "error" in their names.
func IsErrorLine(line string) bool {
	for _, progress := range []string{"Compiling ", "Archiving ", "Indexing ", "Linking ", "Building "} {
		if strings.HasPrefix(line, progress) {
			return false
		}
	}
	if strings.HasPrefix(line, "mg24 upload:") {
		return !strings.Contains(line, "targeting probe")
	}
	lower := strings.ToLower(line)
	return strings.Contains(lower, "error") || strings.Contains(lower, "[failed]")
}
