package onedrive

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sort"
	"sync"
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

// batchUploads bounds concurrent Graph uploads within one PutFiles request.
const batchUploads = 4

func (p *Provider) PutFiles(ctx context.Context, writes []store.FileWrite) ([]string, error) {
	if len(writes) == 0 {
		return []string{}, nil
	}
	seen := make(map[string]bool, len(writes))
	for _, write := range writes {
		if err := validateID(write.ID); err != nil {
			return nil, err
		}
		if seen[write.ID] {
			return nil, store.ErrInvalidID
		}
		seen[write.ID] = true
	}
	state, err := p.load(ctx)
	if err != nil {
		return nil, err
	}
	previous := make([]object, len(writes))
	exists := make([]bool, len(writes))
	for i, write := range writes {
		previous[i], exists[i] = state.Files[write.ID]
		if !matches(write.IfMatch, previous[i].ETag, exists[i]) {
			return nil, store.ErrObjectConflict
		}
	}

	spooled := make([]*spooledObject, 0, len(writes))
	defer func() {
		for _, s := range spooled {
			s.close()
		}
	}()
	for _, write := range writes {
		s, err := p.spool(write.Body)
		if err != nil {
			return nil, err
		}
		spooled = append(spooled, s)
	}

	now := time.Now().UTC()
	uploaded := make([]object, len(writes))
	names := make([]string, len(writes))
	for i, s := range spooled {
		uploaded[i] = object{Name: newObject(), ETag: s.etag, Size: s.size, Updated: now}
		names[i] = uploaded[i].Name
	}
	if err := p.parallel(ctx, len(writes), func(ctx context.Context, i int) error {
		return p.send(ctx, names[i], spooled[i])
	}); err != nil {
		// Nothing was published, so every uploaded object is unreachable.
		p.removeAll(ctx, names)
		return nil, err
	}

	for i, write := range writes {
		state.Files[write.ID] = uploaded[i]
	}
	if err := p.save(ctx, state); err != nil {
		p.discard(ctx, err, names...)
		return nil, err
	}
	var replaced []string
	for i := range writes {
		if exists[i] {
			replaced = append(replaced, previous[i].Name)
		}
	}
	p.removeAll(ctx, replaced)

	etags := make([]string, len(writes))
	for i := range uploaded {
		etags[i] = uploaded[i].ETag
	}
	return etags, nil
}

// parallel runs fn for 0..n-1 with bounded concurrency, stopping on the first error.
func (p *Provider) parallel(ctx context.Context, n int, fn func(context.Context, int) error) error {
	// Resolve the app folder once; concurrent calls then only read the cached value.
	if _, err := p.folder(ctx); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	slots := make(chan struct{}, batchUploads)
	var wg sync.WaitGroup
	var once sync.Once
	var first error
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			if ctx.Err() != nil {
				return
			}
			if err := fn(ctx, i); err != nil {
				once.Do(func() {
					first = err
					cancel()
				})
			}
		}(i)
	}
	wg.Wait()
	if first == nil {
		first = ctx.Err()
	}
	return first
}

// removeAll best-effort deletes objects; failures leave unreferenced data for a later reset.
func (p *Provider) removeAll(ctx context.Context, names []string) {
	if len(names) == 0 {
		return
	}
	// Cleanup can outlive the client, but must release the upload slot if
	// Graph stops responding.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	_ = p.parallel(ctx, len(names), func(ctx context.Context, i int) error {
		_ = p.remove(ctx, names[i])
		return nil
	})
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
