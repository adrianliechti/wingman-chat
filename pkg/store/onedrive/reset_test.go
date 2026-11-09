package onedrive

import (
	"errors"
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
			if err := p.ResetUser(testSession(), "alice"); err != nil {
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
			if err := writer.ResetUser(testSession(), "alice"); err != nil {
				return nil, err
			}
			if _, err := writer.PutObject(testSession(), "alice", store.FileObject, "new-file1", strings.NewReader("new"), "*"); err != nil {
				return nil, err
			}
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession(), "alice"); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("stale reset succeeded: %v", err)
	}
	reader, _, err := writer.GetObject(testSession(), "alice", store.FileObject, "new-file1")
	if got := string(readAll(t, reader, err)); got != "new" {
		t.Fatalf("reset deleted concurrent backup: %q", got)
	}
}
