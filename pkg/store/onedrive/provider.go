// Package onedrive stores encrypted backups in Microsoft Graph's app folder.
// Index snapshots are immutable; Microsoft Graph ETags coordinate commits across
// requests and replicas without a shared filesystem.
package onedrive

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sync"

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
