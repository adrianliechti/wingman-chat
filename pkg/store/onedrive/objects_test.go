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
		if _, err := p.PutObject(testSession(), kind, id, strings.NewReader(content), "*"); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []store.ObjectKind{store.FileObject, store.BlobObject} {
		reader, etag, err := p.GetObject(testSession(), kind, id)
		got := string(readAll(t, reader, err))
		want := "workspace"
		if kind == store.BlobObject {
			want = "attachment"
		}
		if got != want || etag == "" {
			t.Fatalf("kind %d: %q, etag %q", kind, got, etag)
		}
		if _, err := p.PutObject(testSession(), kind, id, strings.NewReader("stale"), "wrong"); !errors.Is(err, store.ErrObjectConflict) {
			t.Fatalf("kind %d: stale write: %v", kind, err)
		}
	}
	if err := p.DeleteObject(testSession(), store.FileObject, id, ""); err != nil {
		t.Fatal(err)
	}
	files, err := p.ListFiles(testSession())
	if err != nil || len(files) != 0 {
		t.Fatalf("deleted file still listed: %v %v", files, err)
	}
	reader, _, err := p.GetObject(testSession(), store.BlobObject, id)
	if got := string(readAll(t, reader, err)); got != "attachment" {
		t.Fatalf("file deletion changed blob: %q", got)
	}
	if exists, err := p.BlobExists(testSession(), id); err != nil || !exists {
		t.Fatalf("blob missing: %v", err)
	}
}

func TestInvalidObjectKindIsRejected(t *testing.T) {
	p, _ := newTestProvider(t)
	for _, kind := range []store.ObjectKind{0, 255} {
		reader, _, err := p.GetObject(testSession(), kind, "object-1234")
		if reader != nil || !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("read kind %d: %v", kind, err)
		}
		if _, err := p.PutObject(testSession(), kind, "object-1234", strings.NewReader("data"), ""); !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("write kind %d: %v", kind, err)
		}
		if err := p.DeleteObject(testSession(), kind, "object-1234", ""); !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("delete kind %d: %v", kind, err)
		}
	}
}

func TestPutFilesPublishesBatchInOneIndexCommit(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), store.FileObject, "existing-1234", strings.NewReader("old"), "*"); err != nil {
		t.Fatal(err)
	}
	before := graph.NextRevision
	files, err := p.ListFiles(testSession())
	if err != nil || len(files) != 1 {
		t.Fatalf("setup: %v %v", files, err)
	}
	writes := []store.FileWrite{
		{ID: "existing-1234", Body: strings.NewReader("new"), IfMatch: files[0].ETag},
		{ID: "created-12345", Body: strings.NewReader("created"), IfMatch: "*"},
	}
	etags, err := p.PutFiles(testSession(), writes)
	if err != nil || len(etags) != 2 {
		t.Fatalf("batch: %v %v", etags, err)
	}
	// Two object uploads plus a single index commit.
	if writes := graph.NextRevision - before; writes != 3 {
		t.Fatalf("batch made %d Graph writes, want 3", writes)
	}
	reader, etag, err := p.GetObject(testSession(), store.FileObject, "existing-1234")
	if got := string(readAll(t, reader, err)); got != "new" || etag != etags[0] {
		t.Fatalf("replaced file: %q %q", got, etag)
	}
	// The replaced object is reclaimed; index plus two live objects remain.
	if objects := len(graph.Folders["backup"]); objects != 3 {
		t.Fatalf("%d stored objects, want 3", objects)
	}

	_, err = p.PutFiles(testSession(), []store.FileWrite{
		{ID: "another-12345", Body: strings.NewReader("x"), IfMatch: "*"},
		{ID: "created-12345", Body: strings.NewReader("y"), IfMatch: "*"},
	})
	if !errors.Is(err, store.ErrObjectConflict) {
		t.Fatalf("conflicting batch: %v", err)
	}
	if _, _, err := p.GetObject(testSession(), store.FileObject, "another-12345"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("conflicting batch published a file: %v", err)
	}
	if objects := len(graph.Folders["backup"]); objects != 3 {
		t.Fatalf("conflicting batch left %d objects", objects)
	}
}
