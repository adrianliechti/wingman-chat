package onedrive

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sort"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (p *Provider) ListFiles(ctx context.Context) ([]store.FileMeta, error) {
	state, err := p.load(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]store.FileMeta, 0, len(state.Files))
	for id, obj := range state.Files {
		out = append(out, store.FileMeta{ID: id, ETag: obj.ETag, Size: obj.Size, Updated: obj.Updated})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out, nil
}
func (p *Provider) GetObject(ctx context.Context, kind store.ObjectKind, id string) (io.ReadCloser, string, error) {
	if err := validateID(id); err != nil {
		return nil, "", err
	}
	state, err := p.load(ctx)
	if err != nil {
		return nil, "", err
	}
	objects, err := objectEntries(state, kind)
	if err != nil {
		return nil, "", err
	}
	obj, ok := objects[id]
	if !ok {
		return nil, "", store.ErrNotFound
	}
	reader, err := p.open(ctx, obj.Name)
	if errors.Is(err, store.ErrNotFound) {
		err = p.missingData(ctx, func(current *index) bool {
			entries, _ := objectEntries(current, kind)
			return entries[id].Name == obj.Name
		})
	}
	if err != nil {
		return nil, "", err
	}
	return reader, obj.ETag, nil
}

// concurrentBlob resolves a lost race between identical uploads. Blob IDs are
// content-addressed and ETags are content hashes, so an entry published by
// another request with the same ETag already holds this content.
func (p *Provider) concurrentBlob(ctx context.Context, id string, uploaded, previous object) bool {
	s, err := sessionFrom(ctx)
	if err != nil || s.snapshot == nil {
		return false
	}
	current, control, err := p.readIndex(ctx)
	if err != nil || current.Generation != s.snapshot.Generation || !bytes.Equal(current.Keystore, s.snapshot.Keystore) {
		return false
	}
	winner, ok := current.Blobs[id]
	if !ok || winner.ETag != uploaded.ETag || winner.Name == uploaded.Name || winner.Name == previous.Name {
		return false
	}
	s.index, s.snapshot, s.control = current, cloneIndex(current), control
	return true
}
func (p *Provider) PutObject(ctx context.Context, kind store.ObjectKind, id string, r io.Reader, ifMatch string) (string, error) {
	if err := validateID(id); err != nil {
		return "", err
	}
	state, err := p.load(ctx)
	if err != nil {
		return "", err
	}
	objects, err := objectEntries(state, kind)
	if err != nil {
		return "", err
	}
	old, exists := objects[id]
	if !matches(ifMatch, old.ETag, exists) {
		return "", store.ErrObjectConflict
	}
	obj := object{Name: newObject(), Updated: time.Now().UTC()}
	obj.ETag, obj.Size, err = p.upload(ctx, obj.Name, r)
	if err != nil {
		return "", err
	}
	objects[id] = obj
	if err := p.save(ctx, state); err != nil {
		if kind == store.BlobObject && errors.Is(err, store.ErrBackupConflict) && p.concurrentBlob(ctx, id, obj, old) {
			_ = p.remove(ctx, obj.Name)
			return obj.ETag, nil
		}
		p.discard(ctx, err, obj.Name)
		return "", err
	}
	if exists {
		_ = p.remove(ctx, old.Name)
	}
	return obj.ETag, nil
}
func (p *Provider) DeleteObject(ctx context.Context, kind store.ObjectKind, id string, ifMatch string) error {
	if err := validateID(id); err != nil {
		return err
	}
	state, err := p.load(ctx)
	if err != nil {
		return err
	}
	objects, err := objectEntries(state, kind)
	if err != nil {
		return err
	}
	old, ok := objects[id]
	if !ok {
		return nil
	}
	if ifMatch != "" && ifMatch != "*" && ifMatch != old.ETag {
		return store.ErrObjectConflict
	}
	delete(objects, id)
	if err := p.save(ctx, state); err != nil {
		return err
	}
	_ = p.remove(ctx, old.Name)
	return nil
}
func (p *Provider) BlobExists(ctx context.Context, blobID string) (bool, error) {
	if err := validateID(blobID); err != nil {
		return false, err
	}
	state, err := p.load(ctx)
	if err != nil {
		return false, err
	}
	obj, exists := state.Blobs[blobID]
	if !exists {
		return false, nil
	}
	endpoint, err := p.objectURL(ctx, obj.Name)
	if err != nil {
		return false, err
	}
	var item driveItem
	err = p.jsonRequest(ctx, "GET", endpoint, nil, &item)
	if statusIs(err, http.StatusNotFound) {
		return false, nil
	}
	return err == nil, err
}

func objectEntries(state *index, kind store.ObjectKind) (map[string]object, error) {
	switch kind {
	case store.FileObject:
		return state.Files, nil
	case store.BlobObject:
		return state.Blobs, nil
	default:
		return nil, store.ErrInvalidID
	}
}
