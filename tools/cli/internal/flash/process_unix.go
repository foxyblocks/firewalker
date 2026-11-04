//go:build unix

package flash

import (
	"os/exec"
	"syscall"
)

// stopWholeProcessGroup makes canceling a job also stop what pio started. pio runs the
// compiler and OpenOCD as child processes, which would otherwise keep running, and keep
// holding the debug probe, after pio itself is gone.
func stopWholeProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
}
