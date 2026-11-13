package onedrive

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/internal/testgraph"
	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func dataObjects(graph *testgraph.Graph) int {
	graph.Mu.Lock()
	defer graph.Mu.Unlock()
	count := 0
	for _, files := range graph.Folders {
		for name := range files {
			if strings.HasPrefix(name, "data-") {
				count++
			}
		}
	}
	return count
}

func loaded(t *testing.T, p *Provider) context.Context {
	t.Helper()
	ctx := testSession()
	if _, err := p.load(ctx, "alice"); err != nil {
		t.Fatal(err)
	}
	return ctx
}

func TestConcurrentIdenticalBlobUploadsSucceed(t *testing.T) {
	p, graph := newTestProvider(t)
	a, b := loaded(t, p), loaded(t, p)
	first, err := p.PutObject(a, "alice", store.BlobObject, "blob-1234", strings.NewReader("same"), "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.PutObject(b, "alice", store.BlobObject, "blob-1234", strings.NewReader("same"), "")
	if err != nil || second != first {
		t.Fatalf("identical concurrent upload: %q %q %v", first, second, err)
	}
	if n := dataObjects(graph); n != 1 {
		t.Fatalf("losing upload left %d data objects", n)
	}
	r, _, err := p.GetObject(testSession(), "alice", store.BlobObject, "blob-1234")
	if got := readAll(t, r, err); string(got) != "same" {
		t.Fatalf("blob: %q", got)
	}
}

func TestConflictingWritesRemoveUnpublishedObjects(t *testing.T) {
	t.Run("blob with different content", func(t *testing.T) {
		p, graph := newTestProvider(t)
		a, b := loaded(t, p), loaded(t, p)
		if _, err := p.PutObject(a, "alice", store.BlobObject, "blob-1234", strings.NewReader("one"), ""); err != nil {
			t.Fatal(err)
		}
		if _, err := p.PutObject(b, "alice", store.BlobObject, "blob-1234", strings.NewReader("two"), ""); !errors.Is(err, store.ErrBackupConflict) {
			t.Fatalf("different content accepted: %v", err)
		}
		if n := dataObjects(graph); n != 1 {
			t.Fatalf("orphaned objects: %d", n)
		}
	})
	t.Run("file", func(t *testing.T) {
		p, graph := newTestProvider(t)
		a, b := loaded(t, p), loaded(t, p)
		if _, err := p.PutObject(a, "alice", store.FileObject, "file-1234", strings.NewReader("winner"), "*"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.PutObject(b, "alice", store.FileObject, "file-1234", strings.NewReader("loser"), "*"); !errors.Is(err, store.ErrObjectConflict) {
			t.Fatalf("lost file CAS: %v", err)
		}
		if n := dataObjects(graph); n != 1 {
			t.Fatalf("orphaned objects: %d", n)
		}
	})
	t.Run("append", func(t *testing.T) {
		p, graph := newTestProvider(t)
		a, b := loaded(t, p), loaded(t, p)
		if _, err := p.AppendEvents(a, "alice", "chat-1234", 0, []string{"first"}, [][]byte{[]byte("one")}); err != nil {
			t.Fatal(err)
		}
		if _, err := p.AppendEvents(b, "alice", "chat-1234", 0, []string{"second"}, [][]byte{[]byte("two")}); !errors.Is(err, store.ErrSeqConflict) {
			t.Fatalf("lost chat CAS: %v", err)
		}
		if n := dataObjects(graph); n != 1 {
			t.Fatalf("orphaned objects: %d", n)
		}
	})
	t.Run("compact", func(t *testing.T) {
		p, graph := newTestProvider(t)
		if _, err := p.AppendEvents(testSession(), "alice", "chat-1234", 0, []string{"e1", "e2", "e3"}, [][]byte{[]byte("1"), []byte("2"), []byte("3")}); err != nil {
			t.Fatal(err)
		}
		stale := loaded(t, p)
		if _, err := p.AppendEvents(testSession(), "alice", "chat-1234", 3, []string{"e4"}, [][]byte{[]byte("4")}); err != nil {
			t.Fatal(err)
		}
		if err := p.CompactChat(stale, "alice", "chat-1234", 2); !errors.Is(err, store.ErrSeqConflict) {
			t.Fatalf("stale compaction: %v", err)
		}
		if n := dataObjects(graph); n != 2 {
			t.Fatalf("orphaned replacement segment: %d objects", n)
		}
	})
}

func TestConcurrentlyRemovedDataReturnsConflict(t *testing.T) {
	p, _ := newTestProvider(t)
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "file-1234", strings.NewReader("old"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AppendEvents(testSession(), "alice", "chat-1234", 0, []string{"e1"}, [][]byte{[]byte("one")}); err != nil {
		t.Fatal(err)
	}
	stale := loaded(t, p)
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "file-1234", strings.NewReader("new"), ""); err != nil {
		t.Fatal(err)
	}
	if err := p.DeleteChat(testSession(), "alice", "chat-1234", 1); err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.GetObject(stale, "alice", store.FileObject, "file-1234"); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("replaced file: %v", err)
	}
	if _, err := p.ReadEvents(stale, "alice", "chat-1234", 0); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("deleted chat: %v", err)
	}
}

func TestLostDataStillReferencedIsNotFound(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "file-1234", strings.NewReader("data"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AppendEvents(testSession(), "alice", "chat-1234", 0, []string{"e1"}, [][]byte{[]byte("one")}); err != nil {
		t.Fatal(err)
	}
	for _, files := range graph.Folders {
		for name := range files {
			if strings.HasPrefix(name, "data-") {
				delete(files, name)
			}
		}
	}
	if _, _, err := p.GetObject(testSession(), "alice", store.FileObject, "file-1234"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("lost file: %v", err)
	}
	if _, err := p.ReadEvents(testSession(), "alice", "chat-1234", 0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("lost segment: %v", err)
	}
}

func TestRecentDedupWindowIsBounded(t *testing.T) {
	p, _ := newTestProvider(t)
	var head int64
	var last []string
	for batch := 0; batch < 3; batch++ {
		ids := make([]string, 60)
		frames := make([][]byte, len(ids))
		for i := range ids {
			ids[i] = fmt.Sprintf("event-%d-%d", batch, i)
			frames[i] = []byte("frame")
		}
		res, err := p.AppendEvents(testSession(), "alice", "chat-1234", head, ids, frames)
		if err != nil {
			t.Fatal(err)
		}
		head, last = res.NewSeq, ids
	}
	ctx := testSession()
	state, err := p.load(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if n := len(state.Chats["chat-1234"].Recent); n != maxRecent {
		t.Fatalf("recent hashes: %d", n)
	}
	frames := make([][]byte, len(last))
	for i := range frames {
		frames[i] = []byte("frame")
	}
	res, err := p.AppendEvents(testSession(), "alice", "chat-1234", head, last, frames)
	if err != nil || res.NewSeq != head || len(res.Deduped) != len(last) {
		t.Fatalf("retried batch not deduped: %+v %v", res, err)
	}
}

func TestConditionalDeleteObject(t *testing.T) {
	p, _ := newTestProvider(t)
	etag, err := p.PutObject(testSession(), "alice", store.FileObject, "file-1234", strings.NewReader("data"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := p.DeleteObject(testSession(), "alice", store.FileObject, "file-1234", "stale"); !errors.Is(err, store.ErrObjectConflict) {
		t.Fatalf("stale delete: %v", err)
	}
	if err := p.DeleteObject(testSession(), "alice", store.FileObject, "file-1234", etag); err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.GetObject(testSession(), "alice", store.FileObject, "file-1234"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted file: %v", err)
	}
	if err := p.DeleteObject(testSession(), "alice", store.FileObject, "file-1234", etag); err != nil {
		t.Fatalf("delete of missing file: %v", err)
	}
}
