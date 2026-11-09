package flash

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

// CheckAppInstall guards a known app downgrade. The running protocol and the
// checkout's declared protocol are the available compatibility evidence: an
// older app may reject newer saved settings even though uploading preserves the
// flash bytes. Unavailable firmware can still be recovered, and an intentional
// downgrade is possible with the explicit command-line option.
func CheckAppInstall(repoRoot string, runningProtocol int, allowDowngrade bool) error {
	if runningProtocol == 0 || allowDowngrade {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(repoRoot, "include", "firewalker_remote_protocol.h"))
	if err != nil {
		return fmt.Errorf("read firmware protocol: %w", err)
	}
	match := regexp.MustCompile(`REMOTE_PROTOCOL_VERSION\s*=\s*(\d+)\s*;`).FindSubmatch(data)
	if match == nil {
		return fmt.Errorf("cannot find REMOTE_PROTOCOL_VERSION in the checkout")
	}
	protocol, err := strconv.Atoi(string(match[1]))
	if err != nil {
		return err
	}
	if runningProtocol > protocol {
		return fmt.Errorf("boot runs protocol %d but this checkout builds protocol %d; use a newer checkout, or --allow-downgrade to install deliberately (older firmware may not read saved settings)", runningProtocol, protocol)
	}
	return nil
}
