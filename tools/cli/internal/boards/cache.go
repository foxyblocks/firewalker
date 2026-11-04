package boards

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// Record is what this tool remembers about one board. A bench build can't answer
// `status`, so once one is flashed this is the only place left to find the boot's saved
// strip layout. It also tells the user what's probably running on a board that can't
// say for itself.
type Record struct {
	ID          string       `json:"id,omitempty"` // the boot's own id, such as 3ED8
	Layout      *SavedLayout `json:"layout,omitempty"`
	LastFlashed string       `json:"lastFlashed,omitempty"` // such as "bench flow" or "imu_debug"
	FlashedAt   time.Time    `json:"flashedAt,omitzero"`
}

// SavedLayout is a boot's strip layout, as it last reported it.
type SavedLayout struct {
	LEDs int `json:"leds"`
	Toe  int `json:"toe"`
	Heel int `json:"heel"`
}

// Cache is the boards.json file, keyed by USB serial. It's a convenience, so nothing
// here is allowed to stop a flash: a missing or damaged file reads as empty, and callers
// can treat a failed write as a warning.
type Cache struct {
	path string
}

// DefaultCachePath is where boards.json lives for this user.
func DefaultCachePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "firewalker-cli", "boards.json"), nil
}

// OpenCache returns the cache stored at path. It reads the file fresh on every call, so
// a TUI and a subcommand running side by side don't overwrite each other's news with a
// stale copy.
func OpenCache(path string) *Cache { return &Cache{path: path} }

// Get returns what's remembered about a board.
func (c *Cache) Get(serial string) (Record, bool) {
	record, ok := c.load()[serial]
	return record, ok
}

// Serials lists every board this tool has seen, so the TUI can show a boot that's
// missing from USB rather than letting it silently disappear.
func (c *Cache) Serials() []string {
	return slices.Sorted(maps.Keys(c.load()))
}

// Update changes one board's record and saves the file. It replaces the file in one step
// so that a crash can't leave half of it behind.
func (c *Cache) Update(serial string, change func(*Record)) error {
	records := c.load()
	record := records[serial]
	change(&record)
	records[serial] = record

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(c.path), "boards-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(append(data, '\n')); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), c.path)
}

func (c *Cache) load() map[string]Record {
	records := map[string]Record{}
	data, err := os.ReadFile(c.path)
	if err != nil {
		return records
	}
	if json.Unmarshal(data, &records) != nil {
		return map[string]Record{}
	}
	return records
}
