package share

import (
	"archive/zip"
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type zipEntry struct {
	name string
	body string
	mode fs.FileMode
}

func buildZip(t *testing.T, entries ...zipEntry) *bytes.Buffer {
	t.Helper()

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	for _, e := range entries {
		header := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			header.SetMode(e.mode)
		}

		f, err := w.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}

		if _, err := f.Write([]byte(e.body)); err != nil {
			t.Fatal(err)
		}
	}

	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	return &buf
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	return NewStore(t.TempDir(), 24*time.Hour, 1<<20)
}

func TestCreateAndGet(t *testing.T) {
	store := newTestStore(t)

	archive := buildZip(t,
		zipEntry{name: "reports/"},
		zipEntry{name: "reports/q3.html", body: "<p>Q3</p>"},
		zipEntry{name: "data/sales.csv", body: "region,amount\n"},
	)

	share, err := store.Create(archive, "/reports/q3.html", "ada@example.com")
	if err != nil {
		t.Fatal(err)
	}

	if !idPattern.MatchString(share.ID) || share.Entry != "reports/q3.html" || share.Files != 2 || share.Owner != "ada@example.com" {
		t.Fatalf("unexpected share: %+v", share)
	}

	got, files, err := store.Get(share.ID)
	if err != nil {
		t.Fatal(err)
	}

	if got.Entry != share.Entry || !got.Created.Equal(share.Created) {
		t.Fatalf("metadata mismatch: %+v vs %+v", got, share)
	}

	data, err := fs.ReadFile(files, "data/sales.csv")
	if err != nil || string(data) != "region,amount\n" {
		t.Fatalf("file content = %q, %v", data, err)
	}

	// Nothing of the upload is left beside the share.
	entries, _ := os.ReadDir(store.dir)
	if len(entries) != 1 || entries[0].Name() != share.ID {
		t.Fatalf("store directory = %v", entries)
	}

	if _, err := os.Stat(filepath.Join(store.dir, share.ID, "upload.zip")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the uploaded archive was kept: %v", err)
	}
}

func TestCreateRejectsUnsafeArchives(t *testing.T) {
	tests := []struct {
		name    string
		entries []zipEntry
		entry   string
		want    string
	}{
		{"parent traversal", []zipEntry{{name: "index.html"}, {name: "../escape.txt"}}, "index.html", "invalid path"},
		{"absolute path", []zipEntry{{name: "index.html"}, {name: "/etc/passwd"}}, "index.html", "invalid path"},
		{"backslash", []zipEntry{{name: "index.html"}, {name: `..\escape.txt`}}, "index.html", "invalid path"},
		{"symlink", []zipEntry{{name: "index.html"}, {name: "link", body: "/etc/passwd", mode: fs.ModeSymlink | 0o777}}, "index.html", "not a regular file"},
		{"duplicate", []zipEntry{{name: "index.html"}, {name: "index.html"}}, "index.html", "conflicts"},
		{"file below file", []zipEntry{{name: "index.html"}, {name: "index.html/x"}}, "index.html", "conflicts"},
		{"missing entry", []zipEntry{{name: "page.html"}}, "index.html", "not in the upload"},
		{"invalid entry", []zipEntry{{name: "index.html"}}, "../index.html", "entry page path is invalid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newTestStore(t)

			_, err := store.Create(buildZip(t, tt.entries...), tt.entry, "")

			var archiveErr ArchiveError
			if !errors.As(err, &archiveErr) || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err = %v, want ArchiveError containing %q", err, tt.want)
			}

			// A rejected upload leaves nothing behind, and nothing escaped the store.
			entries, _ := os.ReadDir(store.dir)
			if len(entries) != 0 {
				t.Fatalf("store directory = %v", entries)
			}

			if _, err := os.Stat(filepath.Join(filepath.Dir(store.dir), "escape.txt")); err == nil {
				t.Fatal("a file escaped the store")
			}
		})
	}
}

func TestCreateRejectsNonZip(t *testing.T) {
	store := newTestStore(t)

	_, err := store.Create(strings.NewReader("<html>not a zip</html>"), "index.html", "")

	var archiveErr ArchiveError
	if !errors.As(err, &archiveErr) {
		t.Fatalf("err = %v, want ArchiveError", err)
	}
}

func TestCreateEnforcesSizeLimit(t *testing.T) {
	store := NewStore(t.TempDir(), time.Hour, 1024)

	// Declared content over the limit, even though the archive itself is small.
	archive := buildZip(t, zipEntry{name: "index.html", body: strings.Repeat("a", 2048)})
	if _, err := store.Create(archive, "index.html", ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("content over limit: err = %v", err)
	}

	// An upload body over the limit plus slack is cut off while receiving.
	body := bytes.NewReader(make([]byte, 1024+archiveSlack+1))
	if _, err := store.Create(body, "index.html", ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("body over limit: err = %v", err)
	}
}

func TestExpiryAndSweep(t *testing.T) {
	store := newTestStore(t)
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	share, err := store.Create(buildZip(t, zipEntry{name: "index.html", body: "hi"}), "index.html", "")
	if err != nil {
		t.Fatal(err)
	}

	if got := store.ExpiresAt(share); !got.Equal(now.Add(24 * time.Hour)) {
		t.Fatalf("ExpiresAt = %v", got)
	}

	abandoned := filepath.Join(store.dir, uploadPrefix+"stale")
	if err := os.Mkdir(abandoned, 0o755); err != nil {
		t.Fatal(err)
	}
	os.Chtimes(abandoned, now.Add(-2*time.Hour), now.Add(-2*time.Hour))

	unrelated := filepath.Join(store.dir, "keep-me")
	if err := os.Mkdir(unrelated, 0o755); err != nil {
		t.Fatal(err)
	}

	now = now.Add(23 * time.Hour)
	store.Sweep()

	if _, _, err := store.Get(share.ID); err != nil {
		t.Fatalf("live share: %v", err)
	}

	if _, err := os.Stat(abandoned); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("abandoned upload kept: %v", err)
	}

	now = now.Add(time.Hour)

	if _, _, err := store.Get(share.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired share: err = %v", err)
	}

	store.Sweep()

	if _, err := os.Stat(filepath.Join(store.dir, share.ID)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expired share kept: %v", err)
	}

	if _, err := os.Stat(unrelated); err != nil {
		t.Fatalf("sweep removed a foreign directory: %v", err)
	}
}

func TestGetRejectsMalformedIDs(t *testing.T) {
	store := newTestStore(t)

	for _, id := range []string{"", "..", "../share", "ABCDEF0123456789ABCDEF0123456789", "0123"} {
		if _, _, err := store.Get(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q) err = %v", id, err)
		}
	}
}

func TestPageTitle(t *testing.T) {
	dir := t.TempDir()

	tests := []struct{ html, want string }{
		{"<html><head><TITLE lang=en>\n  Sales &amp;\tMargins  </TITLE></head></html>", "Sales & Margins"},
		{"<title></title>", ""},
		{"<p>no title</p>", ""},
		{"<title>" + strings.Repeat("ä", 250) + "</title>", strings.Repeat("ä", 199) + "…"},
	}

	for i, tt := range tests {
		path := filepath.Join(dir, strings.Repeat("p", i+1)+".html")
		if err := os.WriteFile(path, []byte(tt.html), 0o644); err != nil {
			t.Fatal(err)
		}

		if got := pageTitle(path); got != tt.want {
			t.Errorf("pageTitle(%q) = %q, want %q", tt.html, got, tt.want)
		}
	}

	if got := pageTitle(filepath.Join(dir, "missing.html")); got != "" {
		t.Errorf("missing page title = %q", got)
	}
}
