//go:build !unix

package flash

import "os/exec"

// stopWholeProcessGroup has no process groups to use here, so canceling stops pio alone.
func stopWholeProcessGroup(*exec.Cmd) {}
