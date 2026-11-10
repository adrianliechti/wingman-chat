package onedrive

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/internal/testgraph"
	storesrv "github.com/adrianliechti/wingman-chat/pkg/server/store"
	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func newTestProvider(t *testing.T) (*Provider, *testgraph.Graph) {
	t.Helper()
	p := New()
	graph := &testgraph.Graph{Folders: map[string]map[string][]byte{}}
	p.client = &http.Client{Transport: graph}
	p.tempDir = t.TempDir()
	return p, graph
}

// Every call uses fresh request-local state, as the real HTTP middleware does.
func withSession(action func(context.Context)) {
	ctx := WithToken(context.Background(), "graph-token")
	action(ctx)
}
func readAll(t *testing.T, r io.ReadCloser, err error) []byte {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestBackupRoundTripAndConflicts(t *testing.T) {
	p, _ := newTestProvider(t)
	user := "alice"
	key := []byte(`{ "version": 2, "backup": {"publicKey":"public","encryptedPrivateKey":"private"} }`)
	var keyETag, fileETag string
	withSession(func(ctx context.Context) {
		var err error
		keyETag, err = p.PutKeystore(ctx, user, key, "*")
		if err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		data, etag, err := p.GetKeystore(ctx, user)
		if err != nil || !bytes.Equal(data, key) || etag != keyETag {
			t.Fatalf("keystore: %s %s %v", data, etag, err)
		}
		if _, err = p.PutKeystore(ctx, user, []byte(`{"version":2}`), etag); !errors.Is(err, store.ErrKeystoreConflict) {
			t.Fatalf("lost envelope accepted: %v", err)
		}
		if _, err = p.PutKeystore(ctx, user, key, "*"); !errors.Is(err, store.ErrKeystoreConflict) {
			t.Fatalf("create overwrite: %v", err)
		}
		fileETag, err = p.PutObject(ctx, user, store.FileObject, "file-1234", strings.NewReader("encrypted-file"), "*")
		if err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		reader, etag, err := p.GetObject(ctx, user, store.FileObject, "file-1234")
		if data := readAll(t, reader, err); string(data) != "encrypted-file" || etag != fileETag {
			t.Fatalf("file: %s %s", data, etag)
		}
		if _, err := p.PutObject(ctx, user, store.FileObject, "file-1234", strings.NewReader("stale"), "wrong"); !errors.Is(err, store.ErrObjectConflict) {
			t.Fatalf("CAS: %v", err)
		}
		files, err := p.ListFiles(ctx, user)
		if err != nil || len(files) != 1 || files[0].Size != 14 {
			t.Fatalf("files: %+v %v", files, err)
		}
		if _, err := p.PutObject(ctx, user, store.BlobObject, "blob-1234", strings.NewReader("encrypted-blob"), ""); err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		exists, err := p.BlobExists(ctx, user, "blob-1234")
		if err != nil || !exists {
			t.Fatalf("blob exists: %v %v", exists, err)
		}
		r, _, err := p.GetObject(ctx, user, store.BlobObject, "blob-1234")
		if data := readAll(t, r, err); string(data) != "encrypted-blob" {
			t.Fatalf("blob: %s", data)
		}
		if size, err := p.BackupSize(ctx, user); err != nil || size < 28 {
			t.Fatalf("size: %d %v", size, err)
		}
		if err := p.DeleteObject(ctx, user, store.BlobObject, "blob-1234", ""); err != nil {
			t.Fatal(err)
		}
		if err := p.DeleteObject(ctx, user, store.FileObject, "file-1234", ""); err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		if exists, err := p.BlobExists(ctx, user, "blob-1234"); err != nil || exists {
			t.Fatalf("deleted blob: %v %v", exists, err)
		}
		if files, err := p.ListFiles(ctx, user); err != nil || len(files) != 0 {
			t.Fatalf("deleted files: %v %v", files, err)
		}
	})
	ctx := WithToken(context.Background(), "graph-token")
	if err := p.ResetUser(ctx, user, newObject()); err != nil {
		t.Fatal(err)
	}
	withSession(func(ctx context.Context) {
		if _, _, err := p.GetKeystore(ctx, user); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("reset: %v", err)
		}
	})
}

func TestChatAppendReplayCompactionAndIsolation(t *testing.T) {
	p, _ := newTestProvider(t)
	withSession(func(ctx context.Context) {
		result, err := p.AppendEvents(ctx, "alice", "chat-1234", 0, []string{"first", "second", "second"}, [][]byte{[]byte("a"), []byte("b"), []byte("b")})
		if err != nil || result.NewSeq != 2 || len(result.Deduped) != 1 {
			t.Fatalf("append: %+v %v", result, err)
		}
	})
	withSession(func(ctx context.Context) {
		if _, err := p.AppendEvents(ctx, "alice", "chat-1234", 0, []string{"third"}, [][]byte{[]byte("c")}); !errors.Is(err, store.ErrSeqConflict) {
			t.Fatalf("sequence: %v", err)
		}
		result, err := p.AppendEvents(ctx, "alice", "chat-1234", 2, []string{"second", "third"}, [][]byte{[]byte("b"), []byte("c")})
		if err != nil || result.NewSeq != 3 || len(result.Deduped) != 1 {
			t.Fatalf("dedup: %+v %v", result, err)
		}
		r, err := p.ReadEvents(ctx, "alice", "chat-1234", 1)
		data := readAll(t, r, err)
		if !bytes.Contains(data, []byte(`"seq":2`)) || !bytes.Contains(data, []byte(`"seq":3`)) || bytes.Contains(data, []byte(`"seq":1`)) {
			t.Fatalf("replay: %s", data)
		}
		if err := p.CompactChat(ctx, "alice", "chat-1234", 2); err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		r, err := p.ReadEvents(ctx, "alice", "chat-1234", 0)
		data := readAll(t, r, err)
		if bytes.Contains(data, []byte(`"seq":1`)) || bytes.Count(data, []byte("\n")) != 2 {
			t.Fatalf("compacted: %s", data)
		}
		result, err := p.AppendEvents(ctx, "alice", "chat-1234", 3, []string{"first"}, [][]byte{[]byte("a")})
		if err != nil || result.NewSeq != 3 || len(result.Deduped) != 1 {
			t.Fatalf("compacted dedup: %+v %v", result, err)
		}
		chats, err := p.ListChats(ctx, "alice")
		if err != nil || len(chats) != 1 || chats[0].HeadSeq != 3 {
			t.Fatalf("chats: %+v %v", chats, err)
		}
	})
	// A different Microsoft account resolves /me to its own OneDrive.
	bob, _ := newTestProvider(t)
	withSession(func(ctx context.Context) {
		if chats, err := bob.ListChats(ctx, "bob"); err != nil || len(chats) != 0 {
			t.Fatalf("account isolation: %+v %v", chats, err)
		}
	})
	withSession(func(ctx context.Context) {
		if err := p.DeleteChat(ctx, "alice", "chat-1234"); err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		if chats, err := p.ListChats(ctx, "alice"); err != nil || len(chats) != 0 {
			t.Fatalf("delete: %+v %v", chats, err)
		}
	})
}

func TestFailedCommitKeepsPreviousFileAndChatHead(t *testing.T) {
	p, graph := newTestProvider(t)
	withSession(func(ctx context.Context) {
		if _, err := p.PutObject(ctx, "alice", store.FileObject, "file-1234", strings.NewReader("old"), "*"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.AppendEvents(ctx, "alice", "chat-1234", 0, []string{"first"}, [][]byte{[]byte("a")}); err != nil {
			t.Fatal(err)
		}
	})
	graph.FailIndex = true
	withSession(func(ctx context.Context) {
		if _, err := p.PutObject(ctx, "alice", store.FileObject, "file-1234", strings.NewReader("new"), ""); err == nil {
			t.Fatal("failed index accepted")
		}
	})
	withSession(func(ctx context.Context) {
		if _, err := p.AppendEvents(ctx, "alice", "chat-1234", 1, []string{"second"}, [][]byte{[]byte("b")}); err == nil {
			t.Fatal("failed head accepted")
		}
	})
	graph.FailIndex = false
	withSession(func(ctx context.Context) {
		r, _, err := p.GetObject(ctx, "alice", store.FileObject, "file-1234")
		if data := readAll(t, r, err); string(data) != "old" {
			t.Fatalf("old file lost: %s", data)
		}
		chats, err := p.ListChats(ctx, "alice")
		if err != nil || len(chats) != 1 || chats[0].HeadSeq != 1 {
			t.Fatalf("uncommitted head: %+v %v", chats, err)
		}
		result, err := p.AppendEvents(ctx, "alice", "chat-1234", 1, []string{"second"}, [][]byte{[]byte("b")})
		if err != nil || result.NewSeq != 2 || len(result.Deduped) != 0 {
			t.Fatalf("retry: %+v %v", result, err)
		}
	})
}

func TestLargeUploadFragmentsAndRetries(t *testing.T) {
	p, graph := newTestProvider(t)
	graph.ChunkFailures = 1
	data := bytes.Repeat([]byte("encrypted"), uploadChunk/9+100)
	withSession(func(ctx context.Context) {
		if _, err := p.PutObject(ctx, "alice", store.BlobObject, "blob-1234", bytes.NewReader(data), ""); err != nil {
			t.Fatal(err)
		}
	})
	withSession(func(ctx context.Context) {
		r, _, err := p.GetObject(ctx, "alice", store.BlobObject, "blob-1234")
		if got := readAll(t, r, err); !bytes.Equal(data, got) {
			t.Fatal("large upload corrupted")
		}
	})
	if graph.Fragments != 2 {
		t.Fatalf("fragments: %d", graph.Fragments)
	}
}
func TestTokenAndUploadURLValidation(t *testing.T) {
	p, _ := newTestProvider(t)
	if _, err := p.ListChats(context.Background(), "alice"); err == nil {
		t.Fatal("missing token accepted")
	}
	for _, raw := range []string{"http://upload.1drv.com/session", "https://evil.test/session", "https://1drv.com.evil.test/session", "https://user:pass@upload.1drv.com/session", "https://upload.1drv.com:1234/session"} {
		if validUploadURL(raw) {
			t.Fatalf("unsafe URL: %s", raw)
		}
	}
	if !validUploadURL("https://sn3302.up.1drv.com/session") {
		t.Fatal("valid upload host rejected")
	}
	withSession(func(ctx context.Context) {
		if _, err := p.PutObject(ctx, "alice", store.FileObject, "../../secret", strings.NewReader("x"), ""); !errors.Is(err, store.ErrInvalidID) {
			t.Fatalf("invalid ID accepted: %v", err)
		}
	})
}

func TestBackupHTTPAPI(t *testing.T) {
	p, _ := newTestProvider(t)
	mux := http.NewServeMux()
	storesrv.New(p, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithToken(r.Context(), "graph-token")))
		})
	}).Attach(mux, "/api")
	call := func(method, path, body string, expected int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/"+path, strings.NewReader(body))
		r.Header.Set("X-Forwarded-User", "alice")
		r.Header.Set("X-Backup-Generation", "test-generation")
		r.Header.Set("X-Expected-Seq", "0")
		r.Header.Set("X-Confirm-Backup-Reset", "true")
		r.Header.Set("X-Backup-Reset-ID", "test-reset-1234")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != expected {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	call("GET", "keystore", "", 404)
	call("GET", "chats", "", 403)
	encode := func(size int) string { return base64.StdEncoding.EncodeToString(make([]byte, size)) }
	key, _ := json.Marshal(map[string]any{
		"version": 2, "kid": 1, "pinProtected": true, "wrappedDek": encode(48), "nonce": encode(12),
		"kdf":    map[string]any{"name": "pbkdf2-sha256", "salt": encode(16), "iter": 600000},
		"backup": map[string]any{"generation": "test-generation", "publicKey": "public", "encryptedPrivateKey": "private"},
	})
	call("PUT", "keystore", string(key), 204)
	call("POST", "chats/chat-1234/events", `{"id":"event-1234","frame":"ciphertext"}`, 200)
	log := call("GET", "chats/chat-1234/events?fromSeq=0", "", 200)
	var line struct {
		Seq   int64  `json:"seq"`
		ID    string `json:"id"`
		Frame string `json:"frame"`
	}
	if err := json.Unmarshal(log.Body.Bytes(), &line); err != nil || line.Frame != "ciphertext" || line.Seq != 1 {
		t.Fatalf("replay format: %s %v", log.Body.String(), err)
	}
	call("PUT", "files/file-1234", "encrypted file", 204)
	call("GET", "files/file-1234", "", 200)
	call("PUT", "blobs/blob-1234", "encrypted blob", 204)
	call("HEAD", "blobs/blob-1234", "", 200)
	call("GET", "backup/usage", "", 200)
	call("DELETE", "backup", "", 204)
	call("GET", "keystore", "", 404)
	call("GET", "files", "", 403)
}

func TestMissingRemoteBlobCanBeReuploaded(t *testing.T) {
	p, graph := newTestProvider(t)
	withSession(func(ctx context.Context) {
		if _, err := p.PutObject(ctx, "alice", store.BlobObject, "blob-1234", strings.NewReader("encrypted"), ""); err != nil {
			t.Fatal(err)
		}
	})
	for _, files := range graph.Folders {
		for name := range files {
			if strings.HasPrefix(name, "data-") {
				delete(files, name)
			}
		}
	}
	withSession(func(ctx context.Context) {
		if exists, err := p.BlobExists(ctx, "alice", "blob-1234"); err != nil || exists {
			t.Fatalf("missing blob reported present: %v %v", exists, err)
		}
		if _, err := p.PutObject(ctx, "alice", store.BlobObject, "blob-1234", strings.NewReader("encrypted"), ""); err != nil {
			t.Fatal(err)
		}
	})
}

func TestHTTPRestoreRejectsInterruptedSegmentDownload(t *testing.T) {
	p, graph := newTestProvider(t)
	withSession(func(ctx context.Context) {
		key := []byte(`{"version":2,"kid":1,"backup":{"generation":"test-generation"},"passkeyProtected":true,"passkey":{"credentialId":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","rpId":"localhost","salt":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nonce":"AAAAAAAAAAAAAAAA","wrappedDek":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}`)
		if _, err := p.PutKeystore(ctx, "alice", key, "*"); err != nil {
			t.Fatal(err)
		}
		for i := int64(0); i < 2; i++ {
			if _, err := p.AppendEvents(ctx, "alice", "chat-1234", i, []string{fmt.Sprintf("event-%d", i)}, [][]byte{[]byte("ciphertext")}); err != nil {
				t.Fatal(err)
			}
		}
		state, err := p.load(ctx, "alice")
		if err != nil {
			t.Fatal(err)
		}
		graph.FailReadName = state.Chats["chat-1234"].Segments[1].Name
	})
	mux := http.NewServeMux()
	storesrv.New(p, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithToken(r.Context(), "graph-token")))
		})
	}).Attach(mux, "/api")
	server := httptest.NewServer(mux)
	defer server.Close()
	req, err := http.NewRequest("GET", server.URL+"/api/v1/chats/chat-1234/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-User", "alice")
	req.Header.Set("X-Backup-Generation", "test-generation")
	res, err := server.Client().Do(req)
	if err != nil {
		return
	} // The server aborted before flushing any response bytes.
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err == nil {
		t.Fatalf("interrupted restore returned a complete HTTP response: %d %s", res.StatusCode, body)
	}
}
