// Package controlconfig reads the defaults shared by every control surface. The
// web tools import this same JSON at build time; the CLI reads it from the checkout
// named by --repo-root, just as it reads the firmware's strip layout. Keeping the
// default in JSON prevents the Go and TypeScript versions drifting apart.
package controlconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Read returns the human inactivity limit. Zero disables automatic pausing. The
// upper bound matches browser timers, so the same setting works in every tool.
func Read(repoRoot string) (time.Duration, error) {
	path := filepath.Join(repoRoot, "config", "control-surfaces.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var config struct {
		InactivityTimeoutMs *int64 `json:"inactivityTimeoutMs"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return 0, fmt.Errorf("config/control-surfaces.json: %w", err)
	}
	if config.InactivityTimeoutMs == nil || *config.InactivityTimeoutMs < 0 || *config.InactivityTimeoutMs > 2147483647 {
		return 0, fmt.Errorf("config/control-surfaces.json: inactivityTimeoutMs must be an integer from 0 to 2147483647")
	}
	return time.Duration(*config.InactivityTimeoutMs) * time.Millisecond, nil
}
