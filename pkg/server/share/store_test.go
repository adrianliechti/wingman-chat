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
	if _, err := store.Create(buildZip(t, zipEntry{name: "index.html", body: strings.Repeat("a", 1024)}), "index.html", ""); err != nil {
		t.Fatalf("content at limit: %v", err)
	}

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

func TestExtractRejectsOverflowingZip64SizesBeforeWriting(t *testing.T) {
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	page, err := w.Create("index.html")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := page.Write(bytes.Repeat([]byte("a"), 2048)); err != nil {
		t.Fatal(err)
	}
	// These declared sizes would wrap the accumulated uint64 total to zero.
	if _, err := w.CreateRaw(&zip.FileHeader{
		Name: "overflow.bin", Method: zip.Store, UncompressedSize64: ^uint64(2048) + 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	archive := filepath.Join(root, "upload.zip")
	if err := os.WriteFile(archive, data.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "extracted")
	store := NewStore(root, time.Hour, 1024)
	if _, _, err := store.extract(archive, dest, "index.html"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("overflowing sizes: err = %v, want ErrTooLarge", err)
	}
	if _, err := os.Stat(dest); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("extraction started before rejecting oversized content: %v", err)
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

func TestSweepKeepsSharesItCannotRead(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("file permissions do not stop root")
	}

	store := newTestStore(t)
	create := func() *Share {
		share, err := store.Create(buildZip(t, zipEntry{name: "index.html", body: "hi"}), "index.html", "")
		if err != nil {
			t.Fatal(err)
		}
		return share
	}

	unreadable, missing, damaged := create(), create(), create()
	meta := func(share *Share) string { return filepath.Join(store.dir, share.ID, metadataFile) }

	// A passing fault of the disk looks like this: the metadata is there but cannot be read now.
	if err := os.Chmod(meta(unreadable), 0o000); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(meta(missing)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(meta(damaged), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}

	store.Sweep()

	if err := os.Chmod(meta(unreadable), 0o644); err != nil {
		t.Fatalf("a live share was swept while unreadable: %v", err)
	}
	if _, _, err := store.Get(unreadable.ID); err != nil {
		t.Fatalf("share after the fault passed: %v", err)
	}

	for name, share := range map[string]*Share{"without metadata": missing, "with damaged metadata": damaged} {
		if _, err := os.Stat(filepath.Join(store.dir, share.ID)); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("folder %s kept: %v", name, err)
		}
	}
}

func TestSweepKeepsUploadsStillArriving(t *testing.T) {
	store := newTestStore(t)
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	upload := func(name string, folder, archive time.Time) string {
		dir := filepath.Join(store.dir, uploadPrefix+name)
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(dir, archiveFile)
		if err := os.WriteFile(file, []byte("partial"), 0o644); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(file, archive, archive)
		os.Chtimes(dir, folder, folder)
		return dir
	}

	// The folder was created two hours ago; only the archive shows whether data still arrives.
	arriving := upload("arriving", now.Add(-2*time.Hour), now.Add(-time.Minute))
	stalled := upload("stalled", now.Add(-2*time.Hour), now.Add(-90*time.Minute))

	store.Sweep()

	if _, err := os.Stat(arriving); err != nil {
		t.Fatalf("an upload still receiving data was swept: %v", err)
	}
	if _, err := os.Stat(stalled); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("stalled upload kept: %v", err)
	}
}

func TestListAndDelete(t *testing.T) {
	store := newTestStore(t)
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	create := func(owner string) *Share {
		t.Helper()
		share, err := store.Create(buildZip(t, zipEntry{name: "index.html", body: "hi"}), "index.html", owner)
		if err != nil {
			t.Fatal(err)
		}
		now = now.Add(time.Hour)
		return share
	}

	first := create("alice")
	other := create("bob")
	nobody := create("")
	second := create("alice")

	ids := func(shares []*Share) string {
		var out []string
		for _, share := range shares {
			out = append(out, share.ID)
		}
		return strings.Join(out, ",")
	}

	if got, want := ids(store.List("alice")), second.ID+","+first.ID; got != want {
		t.Fatalf("alice's shares = %s, want newest first %s", got, want)
	}
	if got := store.List(""); len(got) != 0 {
		t.Fatalf("shares without an owner were listed: %s", ids(got))
	}
	if got := store.List("carol"); got == nil || len(got) != 0 {
		t.Fatalf("carol's shares = %v", got)
	}

	for _, tt := range []struct {
		name, id, owner string
		want            error
	}{
		{"someone else's share", first.ID, "bob", ErrForbidden},
		{"no identity", first.ID, "", ErrForbidden},
		{"a share nobody owns", nobody.ID, "", ErrForbidden},
		{"unknown id", "0123456789abcdef0123456789abcdef", "alice", ErrNotFound},
		{"malformed id", "../" + first.ID, "alice", ErrNotFound},
	} {
		if err := store.Delete(tt.id, tt.owner); !errors.Is(err, tt.want) {
			t.Errorf("Delete %s: err = %v, want %v", tt.name, err, tt.want)
		}
	}

	if _, _, err := store.Get(first.ID); err != nil {
		t.Fatalf("share after refused deletes: %v", err)
	}

	if err := store.Delete(first.ID, "alice"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Get(first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted share: err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.dir, first.ID)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("deleted share's files kept: %v", err)
	}
	if err := store.Delete(first.ID, "alice"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: err = %v", err)
	}
	if got := ids(store.List("alice")); got != second.ID {
		t.Fatalf("alice's shares after deleting one = %s", got)
	}
	if got := ids(store.List("bob")); got != other.ID {
		t.Fatalf("bob's shares = %s", got)
	}

	// Expired shares are neither listed nor deletable; the sweeper removes them.
	now = now.Add(48 * time.Hour)
	if got := store.List("alice"); len(got) != 0 {
		t.Fatalf("expired shares listed: %s", ids(got))
	}
	if err := store.Delete(second.ID, "alice"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete expired: err = %v", err)
	}
}
