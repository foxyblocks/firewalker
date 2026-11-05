//go:build !unix

// Package proc stops long-running tools properly.
package proc

import "os/exec"

// StopGroupOnCancel has no process groups to use here, so canceling stops the command alone.
func StopGroupOnCancel(*exec.Cmd) {}
