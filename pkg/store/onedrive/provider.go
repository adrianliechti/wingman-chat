// Package onedrive stores encrypted backups in Microsoft Graph's app folder.
// Index snapshots are immutable; Microsoft Graph ETags coordinate commits across
// requests and replicas without a shared filesystem.
package onedrive

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/drive/graph"
	"github.com/adrianliechti/wingman-chat/pkg/store"
)

var _ store.Provider = (*Provider)(nil)
var objectName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,200}$`)
var resourceID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

const indexName = "index.json"

type Provider struct {
	client        *http.Client
	base          string
	tempDir       string
	conditionalMu sync.Mutex
	conditional   map[string]bool
}

func New() *Provider {
	return &Provider{client: http.DefaultClient, base: graph.GraphURL, conditional: make(map[string]bool)}
}

type sessionKey struct{}
type session struct {
	token, user, folder string
	index               *index
	snapshot            *index
	control             driveItem
}

// WithToken creates request-local state. Tokens are never stored on disk or in
// the backup. The HTTP layer may exchange a forwarded token using existing OBO.
func WithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, sessionKey{}, &session{token: token})
}
func sessionFrom(ctx context.Context) (*session, error) {
	s, ok := ctx.Value(sessionKey{}).(*session)
	if !ok || s.token == "" {
		return nil, errors.New("OneDrive backup: Microsoft Graph access token required")
	}
	return s, nil
}
func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func newObject() string {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		panic(err)
	}
	return "data-" + hex.EncodeToString(id[:])
}
func validateID(id string) error {
	if !resourceID.MatchString(id) {
		return store.ErrInvalidID
	}
	return nil
}

type object struct {
	Name    string    `json:"name"`
	ETag    string    `json:"etag"`
	Size    int64     `json:"size"`
	Updated time.Time `json:"updated"`
}
type segment struct {
	object
	First int64 `json:"first"`
	Last  int64 `json:"last"`
}
type chat struct {
	Head     int64     `json:"head"`
	Updated  time.Time `json:"updated"`
	Segments []segment `json:"segments"`
	Recent   []string  `json:"recent,omitempty"`
}
type index struct {
	Generation string            `json:"generation,omitempty"`
	ResetIDs   map[string]bool   `json:"resetIds,omitempty"`
	Version    int               `json:"version"`
	Keystore   []byte            `json:"keystore,omitempty"`
	Chats      map[string]chat   `json:"chats"`
	Files      map[string]object `json:"files"`
	Blobs      map[string]object `json:"blobs"`
}

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
func (p *Provider) BackupSize(ctx context.Context, userID string) (int64, error) {
	folder, err := p.folder(ctx, userID)
	if err != nil {
		return 0, err
	}
	var item driveItem
	if err := p.jsonRequest(ctx, "GET", p.base+"/me/drive/items/"+url.PathEscape(folder), nil, &item); err != nil {
		return 0, err
	}
	if item.Size < 0 {
		return 0, errors.New("OneDrive backup: invalid backup size")
	}
	return item.Size, nil
}
func (p *Provider) GetKeystore(ctx context.Context, userID string) ([]byte, string, error) {
	state, err := p.load(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	if len(state.Keystore) == 0 {
		return nil, "", store.ErrNotFound
	}
	return state.Keystore, digest(state.Keystore), nil
}
func (p *Provider) PutKeystore(ctx context.Context, userID string, data []byte, ifMatch string) (string, error) {
	state, err := p.load(ctx, userID)
	if err != nil {
		return "", err
	}
	current := state.Keystore
	if !matches(ifMatch, digest(current), len(current) > 0) || !store.PreservesBackupKey(current, data) {
		return "", store.ErrKeystoreConflict
	}

	state.Keystore = append([]byte(nil), data...)
	if err := p.save(ctx, userID, state); err != nil {
		return "", err
	}
	return digest(state.Keystore), nil
}
func matches(ifMatch, etag string, exists bool) bool {
	switch ifMatch {
	case "":
		return true
	case "*":
		return !exists
	default:
		return exists && ifMatch == etag
	}
}
func (p *Provider) ListFiles(ctx context.Context, userID string) ([]store.FileMeta, error) {
	state, err := p.load(ctx, userID)
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
func (p *Provider) GetObject(ctx context.Context, userID string, kind store.ObjectKind, id string) (io.ReadCloser, string, error) {
	if err := validateID(id); err != nil {
		return nil, "", err
	}
	state, err := p.load(ctx, userID)
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
	reader, err := p.open(ctx, userID, obj.Name)
	if errors.Is(err, store.ErrNotFound) {
		err = p.missingData(ctx, userID, func(current *index) bool {
			entries, _ := objectEntries(current, kind)
			return entries[id].Name == obj.Name
		})
	}
	if err != nil {
		return nil, "", err
	}
	return reader, obj.ETag, nil
}

// missingData classifies a data object that the request's index snapshot
// references but storage no longer has. If a concurrent writer replaced or
// deleted the entry meanwhile, the snapshot is stale and the client should
// retry; otherwise the object is genuinely lost.
func (p *Provider) missingData(ctx context.Context, userID string, stillReferenced func(*index) bool) error {
	current, _, err := p.readIndex(ctx, userID)
	if err != nil {
		return err
	}
	if stillReferenced(current) {
		return store.ErrNotFound
	}
	return store.ErrBackupConflict
}

// definiteConflict reports index commits that certainly did not publish, so
// objects uploaded for them are unreachable and safe to delete.
func definiteConflict(err error) bool {
	return errors.Is(err, store.ErrSeqConflict) || errors.Is(err, store.ErrObjectConflict) ||
		errors.Is(err, store.ErrBackupConflict) || errors.Is(err, store.ErrKeystoreConflict)
}

// discard best-effort removes unpublished objects after a definite conflict.
func (p *Provider) discard(ctx context.Context, userID string, err error, names ...string) {
	if !definiteConflict(err) {
		return
	}
	for _, name := range names {
		_ = p.remove(ctx, userID, name)
	}
}

// concurrentBlob resolves a lost race between identical uploads. Blob IDs are
// content-addressed and ETags are content hashes, so an entry published by
// another request with the same ETag already holds this content.
func (p *Provider) concurrentBlob(ctx context.Context, userID, id string, uploaded, previous object) bool {
	s, err := sessionFrom(ctx)
	if err != nil || s.snapshot == nil {
		return false
	}
	current, control, err := p.readIndex(ctx, userID)
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
func (p *Provider) PutObject(ctx context.Context, userID string, kind store.ObjectKind, id string, r io.Reader, ifMatch string) (string, error) {
	if err := validateID(id); err != nil {
		return "", err
	}
	state, err := p.load(ctx, userID)
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
	obj.ETag, obj.Size, err = p.upload(ctx, userID, obj.Name, r)
	if err != nil {
		return "", err
	}
	objects[id] = obj
	if err := p.save(ctx, userID, state); err != nil {
		if kind == store.BlobObject && errors.Is(err, store.ErrBackupConflict) && p.concurrentBlob(ctx, userID, id, obj, old) {
			_ = p.remove(ctx, userID, obj.Name)
			return obj.ETag, nil
		}
		p.discard(ctx, userID, err, obj.Name)
		return "", err
	}
	if exists {
		_ = p.remove(ctx, userID, old.Name)
	}
	return obj.ETag, nil
}
func (p *Provider) DeleteObject(ctx context.Context, userID string, kind store.ObjectKind, id string, ifMatch string) error {
	if err := validateID(id); err != nil {
		return err
	}
	state, err := p.load(ctx, userID)
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
	if err := p.save(ctx, userID, state); err != nil {
		return err
	}
	_ = p.remove(ctx, userID, old.Name)
	return nil
}
func (p *Provider) BlobExists(ctx context.Context, userID, blobID string) (bool, error) {
	if err := validateID(blobID); err != nil {
		return false, err
	}
	state, err := p.load(ctx, userID)
	if err != nil {
		return false, err
	}
	obj, exists := state.Blobs[blobID]
	if !exists {
		return false, nil
	}
	endpoint, err := p.objectURL(ctx, userID, obj.Name)
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
