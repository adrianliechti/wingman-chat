package onedrive

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

const (
	// Tokens are short-lived; a new token resolves its folder again.
	folderCacheTTL     = time.Hour
	folderCacheEntries = 10000
	// Bounds the serialized size of index snapshots kept across requests.
	indexCacheBytes = 32 << 20
)

// cache keeps lookups that Graph would otherwise repeat on every request.
// Graph still authorizes every call with the request's token: a cached folder
// ID only skips its path lookup, and a cached index snapshot is only used when
// the index item's current ETag, read with that token, matches.
type cache struct {
	mu         sync.Mutex
	folders    map[string]cachedFolder
	indexes    map[string]cachedIndex
	indexBytes int
}

type cachedFolder struct {
	folder, drive string
	expires       time.Time
}

type cachedIndex struct {
	etag  string
	state *index
	size  int
	used  time.Time
}

func tokenKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (c *cache) folder(token string) (cachedFolder, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.folders[tokenKey(token)]
	if !ok || !time.Now().Before(entry.expires) {
		return cachedFolder{}, false
	}
	return entry, true
}

func (c *cache) storeFolder(token, folder, drive string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if c.folders == nil {
		c.folders = map[string]cachedFolder{}
	}
	if len(c.folders) >= folderCacheEntries {
		for key, entry := range c.folders {
			if !now.Before(entry.expires) {
				delete(c.folders, key)
			}
		}
		if len(c.folders) >= folderCacheEntries {
			clear(c.folders)
		}
	}
	c.folders[tokenKey(token)] = cachedFolder{folder: folder, drive: drive, expires: now.Add(folderCacheTTL)}
}

func (c *cache) forgetFolder(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.folders, tokenKey(token))
}

// index returns a private copy of the snapshot published as control.
func (c *cache) index(control driveItem) *index {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.indexes[control.ID]
	if !ok || entry.etag != control.ETag {
		return nil
	}
	entry.used = time.Now()
	c.indexes[control.ID] = entry
	return cloneIndex(entry.state)
}

// storeIndex records state as the content of control. Callers must not
// modify state afterwards.
func (c *cache) storeIndex(control driveItem, state *index, size int) {
	if control.ID == "" || control.ETag == "" || size > indexCacheBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.indexes == nil {
		c.indexes = map[string]cachedIndex{}
	}
	if old, ok := c.indexes[control.ID]; ok {
		c.indexBytes -= old.size
	}
	c.indexes[control.ID] = cachedIndex{etag: control.ETag, state: state, size: size, used: time.Now()}
	c.indexBytes += size
	for c.indexBytes > indexCacheBytes {
		oldest := ""
		for key, entry := range c.indexes {
			if key != control.ID && (oldest == "" || entry.used.Before(c.indexes[oldest].used)) {
				oldest = key
			}
		}
		c.indexBytes -= c.indexes[oldest].size
		delete(c.indexes, oldest)
	}
}
