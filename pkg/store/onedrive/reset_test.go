package onedrive

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func TestResetRecoversCorruptIndex(t *testing.T) {
	for _, content := range []string{"{broken", `{"version":999}`, strings.Repeat("x", (64<<20)+1)} {
		t.Run(content[:min(len(content), 16)], func(t *testing.T) {
			p, graph := newTestProvider(t)
			if _, err := p.PutObject(testSession(), "alice", store.FileObject, "file-1234", strings.NewReader("old"), "*"); err != nil {
				t.Fatal(err)
			}
			graph.Folders["backup"][indexName] = []byte(content)
			if err := p.ResetUser(testSession(), "alice", newObject()); err != nil {
				t.Fatalf("cannot reset corrupt backup: %v", err)
			}
			files, err := p.ListFiles(testSession(), "alice")
			if err != nil || len(files) != 0 {
				t.Fatalf("backup not empty: %v %v", files, err)
			}
			if len(graph.Folders["backup"]) != 1 {
				t.Fatal("reset left encrypted objects behind")
			}
		})
	}
}

func TestCorruptIndexResetDoesNotDeleteConcurrentReplacement(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "old-file1", strings.NewReader("old"), "*"); err != nil {
		t.Fatal(err)
	}
	graph.Folders["backup"][indexName] = []byte("{broken")
	writer := New()
	writer.client = &http.Client{Transport: graph}
	replaced := false
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !replaced && strings.HasSuffix(r.URL.Path, "/children") && r.Method == "GET" {
			replaced = true
			if err := writer.ResetUser(testSession(), "alice", newObject()); err != nil {
				return nil, err
			}
			if _, err := writer.PutObject(testSession(), "alice", store.FileObject, "new-file1", strings.NewReader("new"), "*"); err != nil {
				return nil, err
			}
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession(), "alice", newObject()); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("stale reset succeeded: %v", err)
	}
	reader, _, err := writer.GetObject(testSession(), "alice", store.FileObject, "new-file1")
	if got := string(readAll(t, reader, err)); got != "new" {
		t.Fatalf("reset deleted concurrent backup: %q", got)
	}
}

func TestResetRetryDoesNotEraseNewBackup(t *testing.T) {
	p, _ := newTestProvider(t)
	if err := p.ResetUser(testSession(), "alice", "reset-first-1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "new-file1", strings.NewReader("new"), "*"); err != nil {
		t.Fatal(err)
	}
	// An unacknowledged response must not make this retry reset the new backup.
	if err := p.ResetUser(testSession(), "alice", "reset-first-1234"); err != nil {
		t.Fatal(err)
	}
	reader, _, err := p.GetObject(testSession(), "alice", store.FileObject, "new-file1")
	if got := string(readAll(t, reader, err)); got != "new" {
		t.Fatalf("retry removed new data: %q", got)
	}
	// Remember old IDs across later resets as well.
	if err := p.ResetUser(testSession(), "alice", "reset-second-1234"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "new-file2", strings.NewReader("newer"), "*"); err != nil {
		t.Fatal(err)
	}
	if err := p.ResetUser(testSession(), "alice", "reset-first-1234"); err != nil {
		t.Fatal(err)
	}
	reader, _, err = p.GetObject(testSession(), "alice", store.FileObject, "new-file2")
	if got := string(readAll(t, reader, err)); got != "newer" {
		t.Fatalf("old retry removed new data: %q", got)
	}
}

func TestResetSucceedsWhenOldObjectCleanupFails(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), "alice", store.FileObject, "old-file1", strings.NewReader("old"), "*"); err != nil {
		t.Fatal(err)
	}
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == "DELETE" && strings.Contains(r.URL.Path, ":/data-") {
			return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("denied")), Header: make(http.Header)}, nil
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession(), "alice", "reset-cleanup-1234"); err != nil {
		t.Fatal(err)
	}
	files, err := p.ListFiles(testSession(), "alice")
	if err != nil || len(files) != 0 {
		t.Fatalf("reset index: %v %v", files, err)
	}
}
