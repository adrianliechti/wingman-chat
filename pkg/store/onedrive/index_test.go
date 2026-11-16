package onedrive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func testSession() context.Context { return WithToken(context.Background(), "graph-token") }

func TestReplicasMergeConcurrentIndexCommits(t *testing.T) {
	p, graph := newTestProvider(t)
	replica := New()
	replica.client = p.client
	// Both replicas see the same snapshot before either uploads. No local lock
	// path exists or is shared between them, including on first-time creation.
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "first-commit", true: "existing-index"}[existing], func(t *testing.T) {
			if existing {
				if _, err := p.PutObject(testSession(), store.BlobObject, "blob-base", strings.NewReader("base"), ""); err != nil {
					t.Fatal(err)
				}
			}
			a, b := testSession(), testSession()
			for _, ctx := range []context.Context{a, b} {
				if _, err := p.load(ctx); err != nil {
					t.Fatal(err)
				}
			}
			var wg sync.WaitGroup
			failures := make(chan error, 2)
			wg.Add(2)
			go func() {
				defer wg.Done()
				_, err := p.PutObject(a, store.FileObject, "file-one1", strings.NewReader("one"), "")
				failures <- err
			}()
			go func() {
				defer wg.Done()
				_, err := replica.PutObject(b, store.FileObject, "file-two2", strings.NewReader("two"), "")
				failures <- err
			}()
			wg.Wait()
			close(failures)
			for err := range failures {
				if err != nil {
					t.Fatal(err)
				}
			}
			files, err := p.ListFiles(testSession())
			if err != nil || len(files) != 2 {
				t.Fatalf("lost concurrent file: %+v %v", files, err)
			}
			for id, want := range map[string]string{"file-one1": "one", "file-two2": "two"} {
				r, _, err := replica.GetObject(testSession(), store.FileObject, id)
				if got := readAll(t, r, err); string(got) != want {
					t.Fatalf("%s: %q", id, got)
				}
			}
		})
	}
	graph.Mu.Lock()
	defer graph.Mu.Unlock()
	if graph.NextRevision < 4 {
		t.Fatal("expected conditional updates")
	}
}

func TestConcurrentResourceEditsConflict(t *testing.T) {
	t.Run("file", func(t *testing.T) {
		p, _ := newTestProvider(t)
		a, b := testSession(), testSession()
		p.load(a)
		p.load(b)
		if _, err := p.PutObject(a, store.FileObject, "file-1234", strings.NewReader("winner"), "*"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.PutObject(b, store.FileObject, "file-1234", strings.NewReader("loser"), "*"); !errors.Is(err, store.ErrObjectConflict) {
			t.Fatalf("lost file CAS: %v", err)
		}
		r, _, err := p.GetObject(testSession(), store.FileObject, "file-1234")
		if got := readAll(t, r, err); string(got) != "winner" {
			t.Fatalf("winner overwritten: %q", got)
		}
	})
	t.Run("chat", func(t *testing.T) {
		p, _ := newTestProvider(t)
		a, b := testSession(), testSession()
		p.load(a)
		p.load(b)
		if _, err := p.AppendEvents(a, "chat-1234", 0, []string{"first"}, [][]byte{[]byte("one")}); err != nil {
			t.Fatal(err)
		}
		if _, err := p.AppendEvents(b, "chat-1234", 0, []string{"second"}, [][]byte{[]byte("two")}); !errors.Is(err, store.ErrSeqConflict) {
			t.Fatalf("lost chat CAS: %v", err)
		}
		r, err := p.ReadEvents(testSession(), "chat-1234", 0)
		if got := readAll(t, r, err); !bytes.Contains(got, []byte("first")) || bytes.Contains(got, []byte("second")) {
			t.Fatalf("invalid history: %s", got)
		}
	})
	t.Run("keystore", func(t *testing.T) {
		p, _ := newTestProvider(t)
		a, b := testSession(), testSession()
		p.load(a)
		p.load(b)
		if _, err := p.PutKeystore(a, []byte(`{"note":1}`), "*"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.PutKeystore(b, []byte(`{"note":2}`), "*"); !errors.Is(err, store.ErrKeystoreConflict) {
			t.Fatalf("lost keystore CAS: %v", err)
		}
	})
}

type pausedReader struct {
	source  io.Reader
	started chan struct{}
	resume  chan struct{}
	once    sync.Once
}

func (r *pausedReader) Read(dst []byte) (int, error) {
	r.once.Do(func() { close(r.started); <-r.resume })
	return r.source.Read(dst)
}

func TestResetFencesInFlightUpload(t *testing.T) {
	for _, populated := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty-backup", true: "existing-backup"}[populated], func(t *testing.T) {
			p, _ := newTestProvider(t)
			if populated {
				if _, err := p.PutKeystore(testSession(), []byte(`{"note":1}`), "*"); err != nil {
					t.Fatal(err)
				}
				if _, err := p.PutObject(testSession(), store.FileObject, "old-file1", strings.NewReader("old"), "*"); err != nil {
					t.Fatal(err)
				}
			}
			input := &pausedReader{source: strings.NewReader("stale ciphertext"), started: make(chan struct{}), resume: make(chan struct{})}
			finished := make(chan error, 1)
			go func() {
				_, err := p.PutObject(testSession(), store.FileObject, "stale-file", input, "")
				finished <- err
			}()
			<-input.started
			resetErr := p.ResetUser(testSession())
			if resetErr != nil {
				close(input.resume)
				<-finished
				t.Fatal(resetErr)
			}
			// Configure a fresh backup before the old upload completes. Its generation
			// must still fence the upload even when the old backup had no keystore.
			_, keyErr := p.PutKeystore(testSession(), []byte(`{"note":2}`), "*")
			_, fileErr := p.PutObject(testSession(), store.FileObject, "new-file1", strings.NewReader("new"), "*")
			close(input.resume)
			if err := <-finished; !errors.Is(err, store.ErrBackupConflict) {
				t.Fatalf("stale upload crossed reset: %v", err)
			}
			if keyErr != nil || fileErr != nil {
				t.Fatalf("new backup: %v %v", keyErr, fileErr)
			}
			files, err := p.ListFiles(testSession())
			if err != nil || len(files) != 1 || files[0].ID != "new-file1" {
				t.Fatalf("reset resurrected data: %+v %v", files, err)
			}
		})
	}
}

func TestProtectionChangeFencesStaleUpload(t *testing.T) {
	p, _ := newTestProvider(t)
	if _, err := p.PutKeystore(testSession(), []byte(`{"note":1}`), "*"); err != nil {
		t.Fatal(err)
	}
	stale := testSession()
	_, etag, err := p.GetKeystore(stale)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutKeystore(testSession(), []byte(`{"note":2}`), etag); err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutObject(stale, store.FileObject, "file-1234", strings.NewReader("stale"), ""); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("stale protection accepted: %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIndexReadRetriesChangedETag(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), store.FileObject, "file-old1", strings.NewReader("old"), "*"); err != nil {
		t.Fatal(err)
	}
	writer := New()
	writer.client = &http.Client{Transport: graph}
	changed := false
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		res, err := graph.RoundTrip(r)
		if err == nil && !changed && r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/index.json:/content") {
			changed = true
			if _, err := writer.PutObject(testSession(), store.FileObject, "file-new1", strings.NewReader("new"), "*"); err != nil {
				res.Body.Close()
				return nil, err
			}
		}
		return res, err
	})}
	files, err := p.ListFiles(testSession())
	if err != nil || !changed || len(files) != 2 {
		t.Fatalf("accepted mismatched content and ETag: %+v %v", files, err)
	}
}

func TestUncertainCommitKeepsPublishedObjects(t *testing.T) {
	for _, status := range []int{0, http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(fmt.Sprintf("status-%d", status), func(t *testing.T) {
			p, graph := newTestProvider(t)
			if _, err := p.PutObject(testSession(), store.FileObject, "file-1234", strings.NewReader("old"), "*"); err != nil {
				t.Fatal(err)
			}
			failed := false
			p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				res, err := graph.RoundTrip(r)
				if err == nil && !failed && r.Method == "PUT" && strings.HasSuffix(r.URL.Path, "/content") && r.Header.Get("If-Match") != "" {
					failed = true
					res.Body.Close()
					if status != 0 {
						return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
					}
					return nil, errors.New("response lost after commit")
				}
				return res, err
			})}
			if _, err := p.PutObject(testSession(), store.FileObject, "file-1234", strings.NewReader("committed"), ""); err == nil {
				t.Fatal("uncertain commit reported success")
			}
			r, _, err := p.GetObject(testSession(), store.FileObject, "file-1234")
			if got := readAll(t, r, err); string(got) != "committed" {
				t.Fatalf("committed data removed on uncertainty: %q", got)
			}
		})
	}
}

func TestKeystoreUpdateMergesConcurrentContent(t *testing.T) {
	p, _ := newTestProvider(t)
	if _, err := p.PutKeystore(testSession(), []byte(`{"note":1}`), "*"); err != nil {
		t.Fatal(err)
	}
	ctx := testSession()
	key, etag, err := p.GetKeystore(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.PutObject(testSession(), store.FileObject, "file-1234", strings.NewReader("new"), "*"); err != nil {
		t.Fatal(err)
	}
	key = append(key[:len(key)-1], []byte(`,"pinProtected":true}`)...)
	if _, err := p.PutKeystore(ctx, key, etag); err != nil {
		t.Fatal(err)
	}
	files, err := p.ListFiles(testSession())
	if err != nil || len(files) != 1 {
		t.Fatalf("key update lost concurrent file: %+v %v", files, err)
	}
}

func TestResetCleansOrphansAndPreservesNewBackup(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), store.FileObject, "old-file1", strings.NewReader("old"), "*"); err != nil {
		t.Fatal(err)
	}
	graph.FailIndex = true
	if _, err := p.PutObject(testSession(), store.FileObject, "orphan-11", strings.NewReader("orphan"), "*"); err == nil {
		t.Fatal("failed commit succeeded")
	}
	graph.FailIndex = false
	writer := New()
	writer.client = &http.Client{Transport: graph}
	created := false
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !created && r.Method == "DELETE" {
			created = true
			if _, err := writer.PutObject(testSession(), store.FileObject, "new-file1", strings.NewReader("new"), "*"); err != nil {
				return nil, err
			}
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession()); err != nil {
		t.Fatal(err)
	}
	files, err := p.ListFiles(testSession())
	if err != nil || !created || len(files) != 1 || files[0].ID != "new-file1" {
		t.Fatalf("reset deleted fresh backup: %+v %v", files, err)
	}
	for _, objects := range graph.Folders {
		if len(objects) != 2 {
			t.Fatalf("reset left orphaned data: %v", slices.Collect(maps.Keys(objects)))
		}
	}
}

func TestResetRejectsUntrustedListingContinuation(t *testing.T) {
	p, graph := newTestProvider(t)
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/children") && r.Method == "GET" {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"value":[],"@odata.nextLink":"https://evil.test/steal-token"}`))}, nil
		}
		if r.URL.Host == "evil.test" {
			t.Fatal("Graph token sent to untrusted continuation")
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession()); err == nil {
		t.Fatal("untrusted continuation accepted")
	}
}

func TestResetFollowsListingPages(t *testing.T) {
	p, graph := newTestProvider(t)
	for _, id := range []string{"file-one1", "file-two2"} {
		if _, err := p.PutObject(testSession(), store.FileObject, id, strings.NewReader(id), "*"); err != nil {
			t.Fatal(err)
		}
	}
	state, err := p.load(testSession())
	if err != nil {
		t.Fatal(err)
	}
	names := []string{state.Files["file-one1"].Name, state.Files["file-two2"].Name}
	pages := 0
	p.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/children") {
			page := map[string]any{"value": []map[string]string{{"name": names[pages]}}}
			if pages == 0 {
				page["@odata.nextLink"] = "https://graph.microsoft.com" + r.URL.Path + "?page=2"
			}
			pages++
			data, _ := json.Marshal(page)
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}, nil
		}
		return graph.RoundTrip(r)
	})}
	if err := p.ResetUser(testSession()); err != nil {
		t.Fatal(err)
	}
	if pages != 2 {
		t.Fatalf("only read %d listing pages", pages)
	}
	for _, objects := range graph.Folders {
		if len(objects) != 1 || objects[indexName] == nil {
			t.Fatalf("objects not reclaimed: %v", slices.Collect(maps.Keys(objects)))
		}
	}
}
