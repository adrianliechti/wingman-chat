package file

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// Synced file tree. Contents are encrypted client-side; the real OPFS
// path only exists inside the ciphertext, so entries are addressed by a
// client-derived id. A per-user manifest carries etag/updated/size so
// listing doesn't touch the content files.
//
//	{user}/files/index.json
//	{user}/files/{fileID}

type fileManifestEntry struct {
	ETag    string    `json:"etag"`
	Updated time.Time `json:"updated"`
	Size    int64     `json:"size"`
}

func (p *Provider) filesDir(userID string) string {
	return filepath.Join(p.userDir(userID), "files")
}

func (p *Provider) filePath(userID, fileID string) string {
	return filepath.Join(p.filesDir(userID), fileID)
}

func (p *Provider) fileManifestPath(userID string) string {
	return filepath.Join(p.filesDir(userID), "index.json")
}

func (p *Provider) fileLock(userID string) *sync.Mutex {
	return p.lockFor("files:" + userID)
}

func (p *Provider) loadFileManifest(userID string) (map[string]fileManifestEntry, error) {
	data, err := os.ReadFile(p.fileManifestPath(userID))
	if errors.Is(err, os.ErrNotExist) {
		return map[string]fileManifestEntry{}, nil
	}
	if err != nil {
		return nil, err
	}

	out := map[string]fileManifestEntry{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (p *Provider) saveFileManifest(userID string, m map[string]fileManifestEntry) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return writeAtomic(p.fileManifestPath(userID), data)
}

func (p *Provider) ListFiles(_ context.Context, userID string) ([]store.FileMeta, error) {
	lock := p.fileLock(userID)
	lock.Lock()
	defer lock.Unlock()

	manifest, err := p.loadFileManifest(userID)
	if err != nil {
		return nil, err
	}

	out := make([]store.FileMeta, 0, len(manifest))
	for id, e := range manifest {
		out = append(out, store.FileMeta{ID: id, ETag: e.ETag, Updated: e.Updated, Size: e.Size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out, nil
}

func (p *Provider) GetFile(_ context.Context, userID, fileID string) (io.ReadCloser, string, error) {
	if err := validateID(fileID); err != nil {
		return nil, "", err
	}

	lock := p.fileLock(userID)
	lock.Lock()
	manifest, err := p.loadFileManifest(userID)
	lock.Unlock()
	if err != nil {
		return nil, "", err
	}

	entry, ok := manifest[fileID]
	if !ok {
		return nil, "", store.ErrNotFound
	}

	f, err := os.Open(p.filePath(userID, fileID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", store.ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return f, entry.ETag, nil
}

func (p *Provider) PutFile(_ context.Context, userID, fileID string, r io.Reader, ifMatch string) (string, error) {
	if err := validateID(fileID); err != nil {
		return "", err
	}

	lock := p.fileLock(userID)
	lock.Lock()
	defer lock.Unlock()

	manifest, err := p.loadFileManifest(userID)
	if err != nil {
		return "", err
	}

	current, exists := manifest[fileID]
	switch {
	case ifMatch == "":
		// unconditional
	case ifMatch == "*":
		if exists {
			return "", store.ErrFileConflict
		}
	default:
		if !exists || current.ETag != ifMatch {
			return "", store.ErrFileConflict
		}
	}

	if err := ensureDir(p.filesDir(userID)); err != nil {
		return "", err
	}

	path := p.filePath(userID, fileID)
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()

	hasher := sha256.New()
	size, err := io.Copy(tmp, io.TeeReader(r, hasher))
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmpPath, path)
	}
	if err != nil {
		os.Remove(tmpPath)
		return "", err
	}

	etag := hex.EncodeToString(hasher.Sum(nil))
	manifest[fileID] = fileManifestEntry{ETag: etag, Updated: time.Now().UTC(), Size: size}
	if err := p.saveFileManifest(userID, manifest); err != nil {
		return "", err
	}
	return etag, nil
}

func (p *Provider) DeleteFile(_ context.Context, userID, fileID string) error {
	if err := validateID(fileID); err != nil {
		return err
	}

	lock := p.fileLock(userID)
	lock.Lock()
	defer lock.Unlock()

	manifest, err := p.loadFileManifest(userID)
	if err != nil {
		return err
	}

	if err := os.Remove(p.filePath(userID, fileID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	if _, ok := manifest[fileID]; ok {
		delete(manifest, fileID)
		return p.saveFileManifest(userID, manifest)
	}
	return nil
}
