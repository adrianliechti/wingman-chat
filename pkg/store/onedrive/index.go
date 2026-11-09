package onedrive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"net/url"
	"reflect"
	"slices"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

const indexAttempts = 5

func emptyIndex() *index {
	return &index{Version: 1, Chats: map[string]chat{}, Files: map[string]object{}, Blobs: map[string]object{}}
}

func cloneIndex(state *index) *index {
	copy := *state
	copy.Keystore = slices.Clone(state.Keystore)
	copy.Chats = maps.Clone(state.Chats)
	for id, ch := range copy.Chats {
		ch.Segments = slices.Clone(ch.Segments)
		ch.Recent = slices.Clone(ch.Recent)
		copy.Chats[id] = ch
	}
	copy.Files, copy.Blobs = maps.Clone(state.Files), maps.Clone(state.Blobs)
	return &copy
}

func (p *Provider) load(ctx context.Context, userID string) (*index, error) {
	s, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}
	// Check account ownership even when the request has a cached snapshot.
	if _, err := p.folder(ctx, userID); err != nil {
		return nil, err
	}
	if s.index != nil {
		return s.index, nil
	}
	state, control, err := p.readIndex(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.index, s.snapshot, s.control = state, cloneIndex(state), control
	return state, nil
}

// readIndexControl reads only the commit identity. Reset must also work when
// index contents are corrupt, too large, or written by an unsupported version.
func (p *Provider) readIndexControl(ctx context.Context, userID string) (driveItem, error) {
	endpoint, err := p.objectURL(ctx, userID, indexName)
	if err != nil {
		return driveItem{}, err
	}
	var item driveItem
	err = p.jsonRequest(ctx, "GET", endpoint, nil, &item)
	if statusIs(err, http.StatusNotFound) {
		return driveItem{}, nil
	}
	if err != nil {
		return driveItem{}, err
	}
	if item.ID == "" || item.ETag == "" {
		return driveItem{}, errors.New("OneDrive backup: missing index identity or ETag")
	}
	return item, nil
}

// Read metadata before and after downloading the index. Content downloads can
// redirect to a separate host, so their HTTP ETag need not be the Graph item
// ETag. Accept the snapshot only when the item's identity and ETag are stable.
func (p *Provider) readIndex(ctx context.Context, userID string) (*index, driveItem, error) {
	for attempt := 0; attempt < indexAttempts; attempt++ {
		before, err := p.readIndexControl(ctx, userID)
		if err != nil {
			return nil, driveItem{}, err
		}
		if before.ID == "" {
			return emptyIndex(), driveItem{}, nil
		}
		reader, err := p.open(ctx, userID, indexName)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, driveItem{}, err
		}
		data, err := io.ReadAll(io.LimitReader(reader, (64<<20)+1))
		reader.Close()
		if err != nil {
			return nil, driveItem{}, err
		}
		after, err := p.readIndexControl(ctx, userID)
		if err != nil {
			return nil, driveItem{}, err
		}
		if before.ID != after.ID || before.ETag != after.ETag {
			continue
		}
		state := emptyIndex()
		if len(data) > 64<<20 || json.Unmarshal(data, state) != nil || state.Version != 1 || state.Chats == nil || state.Files == nil || state.Blobs == nil {
			return nil, driveItem{}, errors.New("OneDrive backup: invalid backup index")
		}
		return state, after, nil
	}
	return nil, driveItem{}, store.ErrBackupConflict
}

func (p *Provider) commit(ctx context.Context, userID string, state *index, control driveItem) error {
	if err := p.verifyConditionalWrites(ctx, userID); err != nil {
		return err
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if len(data) > 64<<20 {
		return errors.New("OneDrive backup: backup index exceeds 64 MiB")
	}
	endpoint, err := p.objectURL(ctx, userID, indexName)
	if err != nil {
		return err
	}
	headers := http.Header{"Content-Type": {"application/json"}}
	if control.ETag == "" {
		// Graph defaults to replacement on PUT. Explicit fail semantics make the
		// first commit atomic too, including concurrent first-time key setup.
		endpoint += ":/content?%40microsoft.graph.conflictBehavior=fail"
		headers.Set("If-None-Match", "*")
	} else {
		// Address the existing item by ID, so a deleted index cannot be recreated
		// by a stale update using its old path.
		endpoint = p.base + "/me/drive/items/" + url.PathEscape(control.ID) + "/content"
		headers.Set("If-Match", control.ETag)
	}
	res, err := p.request(ctx, "PUT", endpoint, bytes.NewReader(data), headers, true)
	if err != nil {
		if statusIs(err, http.StatusPreconditionFailed) || statusIs(err, http.StatusConflict) || statusIs(err, http.StatusNotFound) {
			return store.ErrBackupConflict
		}
		return err
	}
	defer res.Body.Close()
	var updated driveItem
	if err := json.NewDecoder(res.Body).Decode(&updated); err != nil {
		return err
	}
	if updated.ID == "" || updated.ETag == "" {
		return errors.New("OneDrive backup: invalid index commit response")
	}
	s, _ := sessionFrom(ctx)
	s.control = updated
	return nil
}

func (p *Provider) save(ctx context.Context, userID string, desired *index) error {
	s, err := sessionFrom(ctx)
	if err != nil {
		return err
	}
	baseline := s.snapshot
	if baseline == nil {
		return errors.New("OneDrive backup: index not loaded")
	}
	current, control := baseline, s.control
	for attempt := 0; attempt < indexAttempts; attempt++ {
		// Protection validation happened against the request's original keystore.
		// Never rebase that validation across a key change or a reset generation.
		if baseline.Generation != current.Generation {
			return store.ErrBackupConflict
		}
		if !bytes.Equal(baseline.Keystore, current.Keystore) {
			if !bytes.Equal(baseline.Keystore, desired.Keystore) {
				return store.ErrKeystoreConflict
			}
			return store.ErrBackupConflict
		}
		merged := cloneIndex(current)
		merged.Keystore = slices.Clone(desired.Keystore)
		if !mergeEntries(baseline.Chats, desired.Chats, current.Chats, merged.Chats) {
			return store.ErrSeqConflict
		}
		if !mergeEntries(baseline.Files, desired.Files, current.Files, merged.Files) {
			return store.ErrObjectConflict
		}
		if !mergeEntries(baseline.Blobs, desired.Blobs, current.Blobs, merged.Blobs) {
			return store.ErrBackupConflict
		}
		err = p.commit(ctx, userID, merged, control)
		if err == nil {
			// Keep the object returned by load current for callers performing multiple
			// operations in a request, while retaining an independent baseline.
			*desired = *merged
			s.index, s.snapshot = desired, cloneIndex(merged)
			return nil
		}
		if !errors.Is(err, store.ErrBackupConflict) {
			return err
		}
		current, control, err = p.readIndex(ctx, userID)
		if err != nil {
			return err
		}
	}
	return store.ErrBackupConflict
}

// Apply only entries changed by this request, preserving unrelated commits.
// A touched entry must still match the original snapshot, including existence.
func mergeEntries[V any](before, desired, current, merged map[string]V) bool {
	keys := make(map[string]struct{}, len(before)+len(desired))
	for key := range before {
		keys[key] = struct{}{}
	}
	for key := range desired {
		keys[key] = struct{}{}
	}
	for key := range keys {
		old, had := before[key]
		next, has := desired[key]
		if had == has && reflect.DeepEqual(old, next) {
			continue
		}
		now, exists := current[key]
		if had != exists || !reflect.DeepEqual(old, now) {
			return false
		}
		if has {
			merged[key] = next
		} else {
			delete(merged, key)
		}
	}
	return true
}
