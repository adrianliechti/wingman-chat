package file

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/chatstore"
)

func newFileProvider(t *testing.T) *Provider {
	t.Helper()
	p, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return p
}

const fileID = "0000000000000000000000000000000000000000000000000000000000000001"

func TestFilePutGetRoundTrip(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()

	etag, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("payload"), "*")
	if err != nil {
		t.Fatal(err)
	}
	if etag == "" {
		t.Fatal("etag must not be empty")
	}

	r, gotEtag, err := p.GetFile(ctx, "alice", fileID)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if gotEtag != etag {
		t.Fatalf("etag mismatch: %s vs %s", gotEtag, etag)
	}
	data, _ := io.ReadAll(r)
	if string(data) != "payload" {
		t.Fatalf("unexpected content: %q", data)
	}
}

func TestFileCAS(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()

	etag, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v1"), "*")
	if err != nil {
		t.Fatal(err)
	}

	// create-only on existing → conflict
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v2"), "*"); !errors.Is(err, chatstore.ErrFileConflict) {
		t.Fatalf("want ErrFileConflict, got %v", err)
	}

	// stale etag → conflict
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v2"), "bogus"); !errors.Is(err, chatstore.ErrFileConflict) {
		t.Fatalf("want ErrFileConflict, got %v", err)
	}

	// current etag → accepted, etag changes with content
	etag2, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v2"), etag)
	if err != nil {
		t.Fatal(err)
	}
	if etag2 == etag {
		t.Fatal("etag must change with content")
	}
}

func TestFileListAndDelete(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()

	other := "0000000000000000000000000000000000000000000000000000000000000002"
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("a"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutFile(ctx, "alice", other, strings.NewReader("bb"), ""); err != nil {
		t.Fatal(err)
	}

	list, err := p.ListFiles(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 files, got %d", len(list))
	}
	for _, m := range list {
		if m.ETag == "" || m.Updated.IsZero() {
			t.Fatalf("incomplete meta: %+v", m)
		}
		if m.ID == other && m.Size != 2 {
			t.Fatalf("size not recorded: %+v", m)
		}
	}

	if err := p.DeleteFile(ctx, "alice", fileID); err != nil {
		t.Fatal(err)
	}
	// idempotent
	if err := p.DeleteFile(ctx, "alice", fileID); err != nil {
		t.Fatal(err)
	}

	if _, _, err := p.GetFile(ctx, "alice", fileID); !errors.Is(err, chatstore.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}

	list, _ = p.ListFiles(ctx, "alice")
	if len(list) != 1 || list[0].ID != other {
		t.Fatalf("unexpected list after delete: %+v", list)
	}
}

func TestFileUserIsolationAndValidation(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()

	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("a"), ""); err != nil {
		t.Fatal(err)
	}

	if _, _, err := p.GetFile(ctx, "bob", fileID); !errors.Is(err, chatstore.ErrNotFound) {
		t.Fatalf("bob must not see alice's file, got %v", err)
	}
	list, _ := p.ListFiles(ctx, "bob")
	if len(list) != 0 {
		t.Fatalf("bob's list must be empty: %+v", list)
	}

	if _, err := p.PutFile(ctx, "alice", "../escape", strings.NewReader("x"), ""); !errors.Is(err, chatstore.ErrInvalidID) {
		t.Fatalf("want ErrInvalidID, got %v", err)
	}
	// the manifest name must not be usable as a file id
	if _, err := p.PutFile(ctx, "alice", "index.json", strings.NewReader("x"), ""); !errors.Is(err, chatstore.ErrInvalidID) {
		t.Fatalf("want ErrInvalidID for index.json, got %v", err)
	}
}
