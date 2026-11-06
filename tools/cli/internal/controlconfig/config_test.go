package controlconfig

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadSharedTimeout(t *testing.T) {
	for _, test := range []struct {
		name, json string
		want       time.Duration
		invalid    bool
	}{
		{"two minutes", `{"inactivityTimeoutMs":120000}`, 2 * time.Minute, false},
		{"custom", `{"inactivityTimeoutMs":45000}`, 45 * time.Second, false},
		{"disabled", `{"inactivityTimeoutMs":0}`, 0, false},
		{"missing", `{}`, 0, true},
		{"negative", `{"inactivityTimeoutMs":-1}`, 0, true},
		{"fraction", `{"inactivityTimeoutMs":1.5}`, 0, true},
		{"overflow", `{"inactivityTimeoutMs":2147483648}`, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "config"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "config", "control-surfaces.json"), []byte(test.json), 0644); err != nil {
				t.Fatal(err)
			}
			got, err := Read(root)
			if (err != nil) != test.invalid || got != test.want {
				t.Fatalf("Read = %v, %v; want %v, invalid=%t", got, err, test.want, test.invalid)
			}
		})
	}
}
