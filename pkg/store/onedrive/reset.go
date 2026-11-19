package onedrive

import (
	"context"
	"errors"
	"log"
	"net/url"
	"strings"
	"time"
)

func (p *Provider) ResetUser(ctx context.Context) error {
	// Read the control item separately so damaged index contents cannot
	// prevent recovery.
	if _, err := p.folder(ctx); err != nil {
		return err
	}
	s, _ := sessionFrom(ctx)
	control, err := p.readIndexControl(ctx)
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
	if err := p.commit(ctx, empty, control); err != nil {
		return err
	}
	s.index, s.snapshot = empty, cloneIndex(empty)
	failed := 0
	for _, name := range names {
		// Cleanup is best effort; resetting again can reclaim leftovers.
		if err := p.remove(ctx, name); err != nil {
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
