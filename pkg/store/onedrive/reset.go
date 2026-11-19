package onedrive

import (
	"context"
	"errors"
	"log"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (p *Provider) ResetUser(ctx context.Context, cond store.ResetCondition) error {
	// Read the control item separately so damaged index contents cannot
	// prevent recovery.
	if _, err := p.folder(ctx); err != nil {
		return err
	}
	s, _ := sessionFrom(ctx)
	control, err := p.resetControl(ctx, cond)
	if err != nil {
		return err
	}

	names, err := p.resetObjects(ctx)
	if err != nil {
		return err
	}
	empty := emptyIndex()
	empty.Generation = newObject()
	// Keep the index item: deleting/recreating it would let stale writers
	// resurrect a backup. Publishing a fresh generation fences all old requests.
	// The commit is conditional on the control checked against cond.
	if err := p.commit(ctx, empty, control); err != nil {
		return err
	}
	s.index, s.snapshot = empty, cloneIndex(empty)
	// The names were listed before the commit, so the new generation cannot
	// reference them. Deleting thousands of segments one by one would outlast
	// the request and make a completed reset look failed.
	p.removeAfterReset(s, names)
	return nil
}

// resetControl returns the index identity to commit against after checking
// that the backup is still the one the user confirmed.
func (p *Provider) resetControl(ctx context.Context, cond store.ResetCondition) (driveItem, error) {
	before, err := p.readIndexControl(ctx)
	if err != nil {
		return driveItem{}, err
	}
	if cond.Unconditional {
		return before, nil
	}
	state, control, err := p.readIndex(ctx)
	if errors.Is(err, errInvalidIndex) {
		if !cond.Unreadable {
			return driveItem{}, store.ErrKeystoreConflict
		}
		// ETags change on every write, so an unchanged control still names the
		// unreadable contents just checked.
		after, err := p.readIndexControl(ctx)
		if err != nil {
			return driveItem{}, err
		}
		if after.ID != before.ID || after.ETag != before.ETag {
			return driveItem{}, store.ErrBackupConflict
		}
		return after, nil
	}
	if err != nil {
		return driveItem{}, err
	}
	switch {
	case cond.Unreadable:
		return driveItem{}, store.ErrKeystoreConflict
	case cond.Keystore == "" && len(state.Keystore) > 0:
		return driveItem{}, store.ErrKeystoreConflict
	case cond.Keystore != "" && (len(state.Keystore) == 0 || digest(state.Keystore) != cond.Keystore):
		return driveItem{}, store.ErrKeystoreConflict
	}
	return control, nil
}

const resetCleanupTimeout = 30 * time.Minute

func (p *Provider) removeAfterReset(s *session, names []string) {
	if s == nil || len(names) == 0 {
		return
	}
	// The request's session is not safe to share once it returns.
	background := context.WithValue(context.Background(), sessionKey{}, &session{token: s.token, folder: s.folder, drive: s.drive, cachedFolder: s.cachedFolder})
	p.cleanup.Add(1)
	go func() {
		defer p.cleanup.Done()
		ctx, cancel := context.WithTimeout(background, resetCleanupTimeout)
		defer cancel()
		var failed atomic.Int64
		_ = p.parallel(ctx, len(names), func(ctx context.Context, i int) error {
			// Cleanup is best effort; resetting again can reclaim leftovers.
			if err := p.remove(ctx, names[i]); err != nil {
				failed.Add(1)
			}
			return nil
		})
		if n := failed.Load(); n > 0 {
			log.Printf("OneDrive backup: reset left %d encrypted objects for later cleanup", n)
		}
	}()
}

// Snapshot object names before the reset commits. Cleanup must never enumerate
// after committing: a new backup may already be publishing fresh objects then.
// Include unpublished objects left by earlier failed/uncertain writes.
func (p *Provider) resetObjects(ctx context.Context) ([]string, error) {
	items, err := p.listObjects(ctx)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(items))
	for i, item := range items {
		names[i] = item.Name
	}
	return names, nil
}

type storedObject struct {
	Name     string    `json:"name"`
	Modified time.Time `json:"lastModifiedDateTime"`
}

// listObjects returns every encrypted data object in the account folder.
func (p *Provider) listObjects(ctx context.Context) ([]storedObject, error) {
	folder, err := p.folder(ctx)
	if err != nil {
		return nil, err
	}
	endpoint := p.base + "/me/drive/items/" + url.PathEscape(folder) + "/children"
	origin, _ := url.Parse(endpoint)
	next := endpoint + "?$select=name,lastModifiedDateTime&$top=200"
	seen := map[string]bool{}
	var objects []storedObject
	for next != "" {
		pageURL, err := url.Parse(next)
		if err != nil || pageURL.Scheme != origin.Scheme || pageURL.Host != origin.Host || pageURL.Path != origin.Path || pageURL.User != nil || seen[next] {
			return nil, errors.New("OneDrive backup: invalid object listing continuation")
		}
		seen[next] = true
		var page struct {
			Value []storedObject `json:"value"`
			Next  string         `json:"@odata.nextLink"`
		}
		if err := p.jsonRequest(ctx, "GET", next, nil, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Value {
			if strings.HasPrefix(item.Name, "data-") && objectName.MatchString(item.Name) {
				objects = append(objects, item)
			}
		}
		next = page.Next
	}
	return objects, nil
}
