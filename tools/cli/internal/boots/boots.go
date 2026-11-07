// Package boots presents the USB boards as people know them: a short boot ID,
// its stable USB serial, and its current firmware status. The command line and
// picker use the same inventory and resolution rules, so an identifier always
// selects the same hardware before install, identify, or diagnostics begins.
package boots

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"firewalker/cli/internal/boards"
	"firewalker/cli/internal/link"
	"firewalker/cli/internal/protocol"
)

// Inventory queries connected boards concurrently. Only USB discovery establishes
// presence; the cache supplies names for connected boards that cannot answer.
type Inventory struct {
	Discover func() ([]boards.Board, error)
	Query    func(context.Context, string) (*protocol.Status, error)
	Cache    *boards.Cache
}

func NewInventory(cache *boards.Cache) Inventory {
	return Inventory{Discover: boards.Discover, Cache: cache, Query: func(ctx context.Context, port string) (*protocol.Status, error) {
		return link.QueryStatus(ctx, port, 1200*time.Millisecond)
	}}
}

// Scan returns every currently connected board, including unavailable firmware.
// A live ID replaces the remembered ID. Cache writes happen after the parallel
// queries so simultaneous replies cannot overwrite another board's record.
func (i Inventory) Scan(ctx context.Context) ([]Boot, error) {
	connected, err := i.Discover()
	if err != nil {
		return nil, err
	}
	result := make([]Boot, len(connected))
	var wg sync.WaitGroup
	for n, board := range connected {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b := Boot{Serial: board.Serial, Port: board.Port}
			if i.Cache != nil {
				if record, ok := i.Cache.Get(board.Serial); ok {
					b.ID, b.Remembered = record.ID, record.ID != ""
				}
			}
			status, err := i.Query(ctx, board.Port)
			if err != nil {
				b.Problem = err.Error()
			} else if status == nil || status.ID == "" {
				b.Problem = "status reply has no boot ID"
			} else {
				b.ID, b.Status, b.Remembered = status.ID, status, false
			}
			result[n] = b
		}()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, b := range result {
		if i.Cache == nil || b.Status == nil {
			continue
		}
		_ = i.Cache.Update(b.Serial, func(r *boards.Record) {
			r.ID = b.ID
			if layout, ok := b.Status.Layout(); ok {
				r.Layout = &boards.SavedLayout{LEDs: layout.LEDs, Toe: layout.Toe, Heel: layout.Heel}
			}
		})
	}
	slices.SortFunc(result, func(a, b Boot) int { return strings.Compare(a.Serial, b.Serial) })
	return result, nil
}

// Boot is one currently connected board. Problem explains a failed status query;
// a remembered ID remains useful for reinstalling a board running a bench build.
type Boot struct {
	ID         string           `json:"id,omitempty"`
	Serial     string           `json:"serial"`
	Port       string           `json:"port"`
	Status     *protocol.Status `json:"status,omitempty"`
	Problem    string           `json:"problem,omitempty"`
	Remembered bool             `json:"remembered,omitempty"`
}

func (b Boot) Name() string {
	if b.ID != "" {
		return b.ID
	}
	return b.Serial
}

// Resolve validates the entire selection before callers touch a board. IDs and
// USB serials ignore case; port paths match exactly. Unknown or ambiguous names
// fail instead of falling through to another boot. Repeated names run only once.
func Resolve(connected []Boot, identifiers []string, all bool) ([]Boot, error) {
	if all && len(identifiers) != 0 {
		return nil, fmt.Errorf("use --all or boot identifiers, not both")
	}
	if len(connected) == 0 {
		return nil, fmt.Errorf("no MG24 on USB; connect a board with a data cable")
	}
	if all {
		return append([]Boot(nil), connected...), nil
	}
	var selected []Boot
	seen := map[string]bool{}
	for _, identifier := range identifiers {
		var matches []Boot
		for _, b := range connected {
			if (b.ID != "" && strings.EqualFold(identifier, b.ID)) || strings.EqualFold(identifier, b.Serial) || identifier == b.Port {
				matches = append(matches, b)
			}
		}
		if len(matches) == 0 {
			return nil, fmt.Errorf("boot %q is not connected; run ./cli list", identifier)
		}
		if len(matches) != 1 {
			return nil, fmt.Errorf("boot %q matches several boards; use a USB serial from ./cli list", identifier)
		}
		if b := matches[0]; !seen[b.Serial] {
			selected = append(selected, b)
			seen[b.Serial] = true
		}
	}
	return selected, nil
}
