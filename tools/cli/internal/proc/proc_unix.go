//go:build unix

// Package proc stops long-running tools properly. The flash and web commands both run a
// tool that starts its own child processes, and canceling needs to reach all of them.
package proc

import (
	"os/exec"
	"syscall"
)

// StopGroupOnCancel makes canceling a command also stop what it started. pio runs the
// compiler and OpenOCD as children, and bun runs Vite, which would otherwise keep running
// and keep holding the debug probe or the port after the parent is gone.
//
// The command gets a process group of its own, which means it can't read the terminal: a
// background group that tries gets frozen by the system. Leave its Stdin unset.
func StopGroupOnCancel(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
}
