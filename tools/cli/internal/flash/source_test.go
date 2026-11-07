package flash_test

import (
	"os"
	"path/filepath"
	"testing"

	"firewalker/cli/internal/flash"
)

func TestAppInstallRejectsAnOlderCheckoutBeforeFlashing(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "include"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "include", "firewalker_remote_protocol.h"), []byte("constexpr uint8_t REMOTE_PROTOCOL_VERSION = 4;\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := flash.CheckAppInstall(repo, 6, false); err == nil {
		t.Fatal("an older app must not replace firmware whose settings it may not understand")
	}
	if err := flash.CheckAppInstall(repo, 4, false); err != nil {
		t.Fatal(err)
	}
	if err := flash.CheckAppInstall(repo, 6, true); err != nil {
		t.Fatal(err)
	}
}
