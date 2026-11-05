package file

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
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
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v2"), "*"); !errors.Is(err, store.ErrFileConflict) {
		t.Fatalf("want ErrFileConflict, got %v", err)
	}

	// stale etag → conflict
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("v2"), "bogus"); !errors.Is(err, store.ErrFileConflict) {
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

	if _, _, err := p.GetFile(ctx, "alice", fileID); !errors.Is(err, store.ErrNotFound) {
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

	if _, _, err := p.GetFile(ctx, "bob", fileID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("bob must not see alice's file, got %v", err)
	}
	list, _ := p.ListFiles(ctx, "bob")
	if len(list) != 0 {
		t.Fatalf("bob's list must be empty: %+v", list)
	}

	if _, err := p.PutFile(ctx, "alice", "../escape", strings.NewReader("x"), ""); !errors.Is(err, store.ErrInvalidID) {
		t.Fatalf("want ErrInvalidID, got %v", err)
	}
	// the manifest name must not be usable as a file id
	if _, err := p.PutFile(ctx, "alice", "index.json", strings.NewReader("x"), ""); !errors.Is(err, store.ErrInvalidID) {
		t.Fatalf("want ErrInvalidID for index.json, got %v", err)
	}
}

type fileReaderFunc func([]byte) (int, error)

func (read fileReaderFunc) Read(buf []byte) (int, error) { return read(buf) }

func TestFileManifestPublicationFailure(t *testing.T) {
	for _, initial := range []string{"", "old", "new"} {
		t.Run("initial="+initial, func(t *testing.T) {
			p := newFileProvider(t)
			ctx := context.Background()
			var etag string
			if initial != "" {
				var err error
				etag, err = p.PutFile(ctx, "alice", fileID, strings.NewReader(initial), "*")
				if err != nil {
					t.Fatal(err)
				}
			}
			manifestPath := p.fileManifestPath("alice")
			previous, err := os.ReadFile(manifestPath)
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				t.Fatal(err)
			}
			blocked := false
			payload := strings.NewReader("new")
			reader := fileReaderFunc(func(buf []byte) (int, error) {
				if !blocked {
					// PutFile has loaded the manifest. Replace its destination
					// with a directory to fail publication after staging data.
					if err := os.Remove(manifestPath); err != nil && !errors.Is(err, os.ErrNotExist) {
						t.Fatal(err)
					}
					if err := os.Mkdir(manifestPath, 0o700); err != nil {
						t.Fatal(err)
					}
					blocked = true
				}
				return payload.Read(buf)
			})
			if _, err := p.PutFile(ctx, "alice", fileID, reader, etag); err == nil {
				t.Fatal("expected manifest publication to fail")
			}
			if err := os.Remove(manifestPath); err != nil {
				t.Fatal(err)
			}
			if previous != nil {
				if err := os.WriteFile(manifestPath, previous, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			r, gotEtag, err := p.GetFile(ctx, "alice", fileID)
			if initial == "" {
				if !errors.Is(err, store.ErrNotFound) {
					t.Fatalf("failed create became visible: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			body, err := io.ReadAll(r)
			if err != nil || string(body) != initial || gotEtag != etag {
				t.Fatalf("failed replacement changed committed file: body=%q etag=%q err=%v", body, gotEtag, err)
			}
		})
	}
}

func TestFileReplacementPreservesOpenReader(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()
	first, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("old"), "*")
	if err != nil {
		t.Fatal(err)
	}
	r, _, err := p.GetFile(ctx, "alice", fileID)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("new"), first); err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(r)
	if err != nil || string(body) != "old" {
		t.Fatalf("open reader lost its snapshot: %q %v", body, err)
	}
	if _, err := os.Stat(p.filePath("alice", fileID) + "." + first); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("obsolete object retained: %v", err)
	}
}

func TestLegacyFileCanBeReadAndReplaced(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()
	if err := ensureDir(p.filesDir("alice")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.filePath("alice", fileID), []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := p.saveFileManifest("alice", map[string]fileManifestEntry{fileID: {ETag: "legacy-etag", Size: 6}}); err != nil {
		t.Fatal(err)
	}
	r, etag, err := p.GetFile(ctx, "alice", fileID)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(r)
	r.Close()
	if err != nil || string(body) != "legacy" || etag != "legacy-etag" {
		t.Fatalf("legacy file unreadable: %q %q %v", body, etag, err)
	}
	if _, err := p.PutFile(ctx, "alice", fileID, strings.NewReader("new"), etag); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.filePath("alice", fileID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("obsolete legacy object retained: %v", err)
	}
}
