package onedrive

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type countingTransport struct {
	next  http.RoundTripper
	mu    sync.Mutex
	calls []string
}

func (c *countingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.mu.Lock()
	c.calls = append(c.calls, r.Method+" "+strings.TrimPrefix(r.URL.Path, "/v1.0/me/drive/"))
	c.mu.Unlock()
	return c.next.RoundTrip(r)
}

func (c *countingTransport) take() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	calls := c.calls
	c.calls = nil
	return calls
}

func TestRepeatedRequestsReuseFolderAndIndex(t *testing.T) {
	p, graph := newTestProvider(t)
	counter := &countingTransport{next: graph}
	p.client = &http.Client{Transport: counter}
	key := []byte(`{"accountId":"a","generation":"g"}`)
	if _, err := p.PutKeystore(testSession(), key, "*"); err != nil {
		t.Fatal(err)
	}
	counter.take()

	// A later request only revalidates the index ETag.
	if data, _, err := p.GetKeystore(testSession()); err != nil || !bytes.Equal(data, key) {
		t.Fatalf("keystore: %s %v", data, err)
	}
	if calls := counter.take(); len(calls) != 1 || calls[0] != "GET items/backup:/index.json" {
		t.Fatalf("calls: %q", calls)
	}

	// A change published by another replica is downloaded.
	writer := New()
	writer.client = &http.Client{Transport: graph}
	writer.tempDir = t.TempDir()
	if _, err := writer.PutObject(testSession(), store.FileObject, "file-0001", strings.NewReader("x"), "*"); err != nil {
		t.Fatal(err)
	}
	if files, err := p.ListFiles(testSession()); err != nil || len(files) != 1 {
		t.Fatalf("missed another replica's commit: %v %v", files, err)
	}
}

func TestStaleCachedFolderIsResolvedAgain(t *testing.T) {
	p, _ := newTestProvider(t)
	key := []byte(`{"accountId":"a","generation":"g"}`)
	if _, err := p.PutKeystore(testSession(), key, "*"); err != nil {
		t.Fatal(err)
	}
	// Simulate an account folder that was deleted and recreated elsewhere.
	p.cache.storeFolder("graph-token", "gone", "test-drive")
	withSession(func(ctx context.Context) {
		if data, _, err := p.GetKeystore(ctx); err != nil || !bytes.Equal(data, key) {
			t.Fatalf("stale folder hid the backup: %s %v", data, err)
		}
	})
	if cached, _ := p.cache.folder("graph-token"); cached.folder != "backup" {
		t.Fatalf("cached folder: %+v", cached)
	}
}

func TestReplacedObjectIsRemovedAfterResponse(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), store.FileObject, "file-0001", strings.NewReader("old"), ""); err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == "DELETE" {
			<-release
		}
		return graph.RoundTrip(r)
	})}
	if _, err := p.PutObject(testSession(), store.FileObject, "file-0001", strings.NewReader("new"), ""); err != nil {
		t.Fatal(err)
	}
	if n := dataObjects(graph); n != 2 {
		t.Fatalf("objects before cleanup: %d", n)
	}
	close(release)
	p.cleanup.Wait()
	if n := dataObjects(graph); n != 1 {
		t.Fatalf("replaced object kept: %d objects", n)
	}
}

func TestIndexCacheIsBounded(t *testing.T) {
	var c cache
	for _, id := range []string{"a", "b", "c"} {
		c.storeIndex(driveItem{ID: id, ETag: "1"}, emptyIndex(), indexCacheBytes/2)
	}
	if len(c.indexes) != 2 || c.indexBytes > indexCacheBytes || c.index(driveItem{ID: "c", ETag: "1"}) == nil {
		t.Fatalf("cache kept %d entries (%d bytes)", len(c.indexes), c.indexBytes)
	}
	if c.index(driveItem{ID: "c", ETag: "2"}) != nil {
		t.Fatal("snapshot returned for a different ETag")
	}
}
