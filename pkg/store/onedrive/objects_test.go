package onedrive

import (
	"errors"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func TestObjectNamespacesStayIndependent(t *testing.T) {
	p, _ := newTestProvider(t)
	const id = "shared-1234"
	for _, kind := range []store.ObjectKind{store.FileObject, store.BlobObject} {
		content := "workspace"
		if kind == store.BlobObject {
			content = "attachment"
		}
		if _, err := p.PutObject(testSession(), "alice", kind, id, strings.NewReader(content), "*"); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []store.ObjectKind{store.FileObject, store.BlobObject} {
		reader, etag, err := p.GetObject(testSession(), "alice", kind, id)
		got := string(readAll(t, reader, err))
		want := "workspace"
		if kind == store.BlobObject {
			want = "attachment"
		}
		if got != want || etag == "" {
			t.Fatalf("kind %d: %q, etag %q", kind, got, etag)
		}
		if _, err := p.PutObject(testSession(), "alice", kind, id, strings.NewReader("stale"), "wrong"); !errors.Is(err, store.ErrObjectConflict) {
			t.Fatalf("kind %d: stale write: %v", kind, err)
		}
	}
	if err := p.DeleteObject(testSession(), "alice", store.FileObject, id, ""); err != nil {
		t.Fatal(err)
	}
	files, err := p.ListFiles(testSession(), "alice")
	if err != nil || len(files) != 0 {
		t.Fatalf("deleted file still listed: %v %v", files, err)
	}
	reader, _, err := p.GetObject(testSession(), "alice", store.BlobObject, id)
	if got := string(readAll(t, reader, err)); got != "attachment" {
		t.Fatalf("file deletion changed blob: %q", got)
	}
	if exists, err := p.BlobExists(testSession(), "alice", id); err != nil || !exists {
		t.Fatalf("blob missing: %v", err)
	}
}

func TestInvalidObjectKindIsRejected(t *testing.T) {
	p, _ := newTestProvider(t)
	for _, kind := range []store.ObjectKind{0, 255} {
		reader, _, err := p.GetObject(testSession(), "alice", kind, "object-1234")
		if reader != nil || !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("read kind %d: %v", kind, err)
		}
		if _, err := p.PutObject(testSession(), "alice", kind, "object-1234", strings.NewReader("data"), ""); !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("write kind %d: %v", kind, err)
		}
		if err := p.DeleteObject(testSession(), "alice", kind, "object-1234", ""); !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("delete kind %d: %v", kind, err)
		}
	}
}
