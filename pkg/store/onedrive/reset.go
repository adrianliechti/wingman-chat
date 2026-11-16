package onedrive

import (
	"context"
	"errors"
	"log"
	"net/url"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (p *Provider) ResetUser(ctx context.Context, userID, resetID string) error {
	if !resourceID.MatchString(resetID) {
		return store.ErrInvalidID
	}
	// Read the control item separately so damaged index contents cannot
	// prevent recovery.
	if _, err := p.folder(ctx, userID); err != nil {
		return err
	}
	s, _ := sessionFrom(ctx)
	control, err := p.readIndexControl(ctx, userID)
	if err != nil {
		return err
	}

	// Remember completed reset IDs across subsequent backups and resets. A retry
	// after an uncertain response must never erase a newly enrolled backup.
	previous, observed, readErr := p.readIndex(ctx, userID)
	if readErr == nil {
		if observed.ID != control.ID || observed.ETag != control.ETag {
			return store.ErrBackupConflict
		}
		if previous.ResetIDs[resetID] {
			return nil
		}
	} else {
		if !errors.Is(readErr, errInvalidIndex) {
			return readErr
		}
		previous = emptyIndex()
	}

	names, err := p.resetObjects(ctx, userID)
	if err != nil {
		return err
	}
	empty := emptyIndex()
	empty.Generation = newObject()
	empty.ResetIDs = previous.ResetIDs
	if empty.ResetIDs == nil {
		empty.ResetIDs = map[string]bool{}
	}
	empty.ResetIDs[resetID] = true
	// Keep the index item: deleting/recreating it would let stale writers
	// resurrect a backup. Publishing a fresh generation fences all old requests.
	if err := p.commit(ctx, userID, empty, control); err != nil {
		return err
	}
	s.index, s.snapshot = empty, cloneIndex(empty)
	failed := 0
	for _, name := range names {
		// Cleanup is best effort; resetting again can reclaim leftovers.
		if err := p.remove(ctx, userID, name); err != nil {
			failed++
		}
	}
	if failed > 0 {
		log.Printf("OneDrive backup: reset left %d encrypted objects for later cleanup", failed)
	}
	return nil
}

// Snapshot object names before the reset commits. Cleanup must never enumerate
// after committing: a new backup may already be publishing fresh objects then.
// Include unpublished objects left by earlier failed/uncertain writes.
func (p *Provider) resetObjects(ctx context.Context, userID string) ([]string, error) {
	folder, err := p.folder(ctx, userID)
	if err != nil {
		return nil, err
	}
	endpoint := p.base + "/me/drive/items/" + url.PathEscape(folder) + "/children"
	origin, _ := url.Parse(endpoint)
	next := endpoint + "?$select=name&$top=200"
	seen := map[string]bool{}
	var names []string
	for next != "" {
		pageURL, err := url.Parse(next)
		if err != nil || pageURL.Scheme != origin.Scheme || pageURL.Host != origin.Host || pageURL.Path != origin.Path || pageURL.User != nil || seen[next] {
			return nil, errors.New("OneDrive backup: invalid object listing continuation")
		}
		seen[next] = true
		var page struct {
			Value []struct {
				Name string `json:"name"`
			} `json:"value"`
			Next string `json:"@odata.nextLink"`
		}
		if err := p.jsonRequest(ctx, "GET", next, nil, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Value {
			if (strings.HasPrefix(item.Name, "data-") || strings.HasPrefix(item.Name, "probe-")) && objectName.MatchString(item.Name) {
				names = append(names, item.Name)
			}
		}
		next = page.Next
	}
	return names, nil
}
