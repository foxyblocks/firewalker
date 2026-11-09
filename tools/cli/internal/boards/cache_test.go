package boards

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCacheStartsEmptyWhenTheFileIsMissing(t *testing.T) {
	cache := OpenCache(filepath.Join(t.TempDir(), "nested", "boards.json"))
	if _, ok := cache.Get("FBC116E9"); ok {
		t.Fatal("expected nothing remembered")
	}
}

func TestCacheRemembersABoardAcrossRuns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "boards.json")
	flashed := time.Date(2026, 11, 4, 22, 14, 0, 0, time.UTC)
	err := OpenCache(path).Update("99C817E5", func(r *Record) {
		r.ID = "3ED8"
		r.Layout = &SavedLayout{LEDs: 94, Toe: 86, Heel: 48}
		r.LastFlashed = "bench rainbow-pool"
		r.FlashedAt = flashed
	})
	if err != nil {
		t.Fatal(err)
	}

	got, ok := OpenCache(path).Get("99C817E5")
	if !ok {
		t.Fatal("expected the board to be remembered")
	}
	if got.ID != "3ED8" || got.LastFlashed != "bench rainbow-pool" || !got.FlashedAt.Equal(flashed) {
		t.Fatalf("got %+v", got)
	}
	if got.Layout == nil || *got.Layout != (SavedLayout{LEDs: 94, Toe: 86, Heel: 48}) {
		t.Fatalf("layout = %+v", got.Layout)
	}
}

// Learning about one boot can't forget the other, and a later update to the same boot
// keeps what it doesn't change: flashing a bench build doesn't lose the saved layout.
func TestCacheUpdateKeepsEverythingElse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "boards.json")
	cache := OpenCache(path)
	mustUpdate(t, cache, "LEFT", func(r *Record) { r.Layout = &SavedLayout{LEDs: 110, Toe: 36, Heel: 91} })
	mustUpdate(t, cache, "RIGHT", func(r *Record) { r.ID = "3ED8" })
	mustUpdate(t, cache, "LEFT", func(r *Record) { r.LastFlashed = "bench rainbow-pool" })

	reopened := OpenCache(path)
	left, _ := reopened.Get("LEFT")
	if left.Layout == nil || left.LastFlashed != "bench rainbow-pool" {
		t.Fatalf("left = %+v", left)
	}
	if right, _ := reopened.Get("RIGHT"); right.ID != "3ED8" {
		t.Fatalf("right = %+v", right)
	}
	if serials := reopened.Serials(); len(serials) != 2 {
		t.Fatalf("serials = %v", serials)
	}
}

// The cache only saves typing, so a damaged file must never stop a flash.
func TestCacheTreatsADamagedFileAsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "boards.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	cache := OpenCache(path)
	if _, ok := cache.Get("LEFT"); ok {
		t.Fatal("expected nothing remembered")
	}
	mustUpdate(t, cache, "LEFT", func(r *Record) { r.ID = "3EB5" })
	if got, _ := OpenCache(path).Get("LEFT"); got.ID != "3EB5" {
		t.Fatalf("got %+v", got)
	}
}

func mustUpdate(t *testing.T, cache *Cache, serial string, change func(*Record)) {
	t.Helper()
	if err := cache.Update(serial, change); err != nil {
		t.Fatal(err)
	}
}
