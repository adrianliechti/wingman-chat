package store

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/internal/testgraph"
	"github.com/adrianliechti/wingman-chat/pkg/store"
	"github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	provider := newTestStore(t)

	mux := http.NewServeMux()
	New(provider, testStoreMiddleware).Attach(mux, "")

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, srv *httptest.Server, user, method, path, body string, headers map[string]string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("X-Forwarded-User", user)
	}
	if method == "DELETE" && path == "/v1/backup" {
		req.Header.Set("X-Backup-Reset-ID", "test-reset-1234")
	}
	req.Header.Set("X-Backup-Generation", "test-generation")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func wantStatus(t *testing.T, res *http.Response, want int) {
	t.Helper()
	if res.StatusCode != want {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("%s %s: got %d, want %d (%s)", res.Request.Method, res.Request.URL.Path, res.StatusCode, want, body)
	}
}

func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func appendEvents(t *testing.T, srv *httptest.Server, user, chatID string, expectedSeq int64, events ...string) store.AppendResult {
	t.Helper()

	res := do(t, srv, user, "POST", "/v1/chats/"+chatID+"/events", strings.Join(events, "\n"),
		map[string]string{"X-Expected-Seq": fmt.Sprint(expectedSeq)})
	wantStatus(t, res, http.StatusOK)

	var out store.AppendResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func event(id, frame string) string {
	return fmt.Sprintf(`{"id":%q,"frame":%q}`, id, frame)
}

func protectedTestKey(note string) string {
	key := map[string]any{
		"version": 2, "kid": 1, "pinProtected": true,
		"wrappedDek": base64.StdEncoding.EncodeToString(make([]byte, 48)),
		"nonce":      base64.StdEncoding.EncodeToString(make([]byte, 12)),
		"kdf":        map[string]any{"name": "pbkdf2-sha256", "salt": base64.StdEncoding.EncodeToString(make([]byte, 16)), "iter": 600000},
		"note":       note,
		"backup":     map[string]string{"generation": "test-generation", "publicKey": "public", "encryptedPrivateKey": "encrypted"},
	}
	data, _ := json.Marshal(key)
	return string(data)
}

func protectedTestServer(t *testing.T) *httptest.Server {
	srv := newTestServer(t)
	for _, user := range []string{"alice", "bob"} {
		wantStatus(t, do(t, srv, user, "PUT", "/v1/keystore", protectedTestKey("initial"), map[string]string{"If-None-Match": "*"}), http.StatusNoContent)
	}
	return srv
}

func TestRequireUser(t *testing.T) {
	srv := newTestServer(t)

	for _, path := range []string{"/v1/me", "/v1/chats", "/v1/keystore"} {
		res := do(t, srv, "", "GET", path, "", nil)
		wantStatus(t, res, http.StatusUnauthorized)
	}
}

func TestMe(t *testing.T) {
	srv := newTestServer(t)

	res := do(t, srv, "alice", "GET", "/v1/me", "", nil)
	wantStatus(t, res, http.StatusOK)

	var u struct {
		ID    string `json:"id"`
		Key   string `json:"key"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(res.Body).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if len(u.ID) != 32 {
		t.Fatalf("id should be 16 hashed bytes hex-encoded, got %q", u.ID)
	}
	if u.Key != "" {
		t.Fatal("/me leaked the private storage key")
	}

	res2 := do(t, srv, "alice", "GET", "/v1/me", "", nil)
	var u2 struct {
		ID string `json:"id"`
	}
	json.NewDecoder(res2.Body).Decode(&u2)
	if u.ID != u2.ID {
		t.Fatal("identity must be stable across requests")
	}
}

func TestIdentityNormalization(t *testing.T) {
	srv := newTestServer(t)

	// Padded and trimmed header values must land in the same store.
	res := do(t, srv, "  alice  ", "PUT", "/v1/keystore", protectedTestKey("one"), map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusNoContent)
	res = do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusOK)

	// A whitespace-only user header falls back to the email for storage,
	// never to the raw whitespace string.
	res = do(t, srv, "   ", "PUT", "/v1/keystore", protectedTestKey("two"), map[string]string{
		"If-None-Match":     "*",
		"X-Forwarded-Email": "bob@example.com",
	})
	wantStatus(t, res, http.StatusNoContent)
	res = do(t, srv, "bob@example.com", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); body != protectedTestKey("two") {
		t.Fatalf("email-fallback keystore mismatch: %s", body)
	}
	// A different email with the same whitespace user must NOT see it.
	res = do(t, srv, "   ", "GET", "/v1/keystore", "", map[string]string{"X-Forwarded-Email": "carol@example.com"})
	wantStatus(t, res, http.StatusNotFound)
}

func TestKeystoreLifecycle(t *testing.T) {
	srv := newTestServer(t)

	res := do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusNotFound)

	res = do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("one"), map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusNoContent)
	etag := strings.Trim(res.Header.Get("ETag"), `"`)
	if etag == "" {
		t.Fatal("PUT must return an ETag")
	}

	// create-only again → conflict
	res = do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("two"), map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusPreconditionFailed)

	// CAS with a stale etag → conflict
	res = do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("two"), map[string]string{"If-Match": `"bogus"`})
	wantStatus(t, res, http.StatusPreconditionFailed)

	// CAS with the current etag → accepted
	res = do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("two"), map[string]string{"If-Match": `"` + etag + `"`})
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); body != protectedTestKey("two") {
		t.Fatalf("unexpected keystore body: %s", body)
	}
}

func TestAppendAndReadEvents(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "11111111-1111-1111-1111-111111111111"

	out := appendEvents(t, srv, "alice", chatID, 0, event("e1", "ZnJhbWUx"), event("e2", "ZnJhbWUy"))
	if out.NewSeq != 2 {
		t.Fatalf("newSeq = %d, want 2", out.NewSeq)
	}

	res := do(t, srv, "alice", "GET", "/v1/chats/"+chatID+"/events", "", nil)
	wantStatus(t, res, http.StatusOK)
	lines := strings.Split(strings.TrimSpace(readBody(t, res)), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d lines, want 2: %v", len(lines), lines)
	}

	res = do(t, srv, "alice", "GET", "/v1/chats/"+chatID+"/events?fromSeq=1", "", nil)
	wantStatus(t, res, http.StatusOK)
	body := strings.TrimSpace(readBody(t, res))
	if !strings.Contains(body, `"seq":2`) || strings.Contains(body, `"seq":1`) {
		t.Fatalf("fromSeq=1 should return only seq 2: %s", body)
	}

	// stale expected seq → 409
	res = do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/events", event("e3", "eA=="),
		map[string]string{"X-Expected-Seq": "0"})
	wantStatus(t, res, http.StatusConflict)

	// missing header / empty body → 400
	res = do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/events", event("e4", "eA=="), nil)
	wantStatus(t, res, http.StatusBadRequest)
	res = do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/events", "", map[string]string{"X-Expected-Seq": "2"})
	wantStatus(t, res, http.StatusBadRequest)
}

func TestAppendDedup(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "22222222-2222-2222-2222-222222222222"

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "ZnJhbWUx"))

	// Idempotent retry of the same event id at the new head.
	out := appendEvents(t, srv, "alice", chatID, 1, event("e1", "ZnJhbWUx"))
	if out.NewSeq != 1 {
		t.Fatalf("newSeq = %d, want unchanged head 1", out.NewSeq)
	}
	if len(out.Deduped) != 1 || out.Deduped[0] != "e1" {
		t.Fatalf("deduped = %v, want [e1]", out.Deduped)
	}
}

func TestListChats(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "33333333-3333-3333-3333-333333333333"

	res := do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := strings.TrimSpace(readBody(t, res)); body != "[]" {
		t.Fatalf("empty store should list []: %s", body)
	}

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "ZnJhbWUx"))

	res = do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	var chats []store.ChatMeta
	if err := json.NewDecoder(res.Body).Decode(&chats); err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].ID != chatID || chats[0].HeadSeq != 1 {
		t.Fatalf("unexpected chat list: %+v", chats)
	}
}

func TestCompact(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "44444444-4444-4444-4444-444444444444"

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "YQ=="), event("e2", "Yg=="), event("e3", "Yw=="))

	res := do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/compact?beforeSeq=3", "", nil)
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "GET", "/v1/chats/"+chatID+"/events", "", nil)
	body := strings.TrimSpace(readBody(t, res))
	if strings.Contains(body, `"seq":1`) || strings.Contains(body, `"seq":2`) || !strings.Contains(body, `"seq":3`) {
		t.Fatalf("compaction should keep only seq >= 3: %s", body)
	}

	// head must survive compaction: next append still requires expectedSeq 3
	appendEvents(t, srv, "alice", chatID, 3, event("e4", "ZA=="))

	res = do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/compact?beforeSeq=0", "", nil)
	wantStatus(t, res, http.StatusBadRequest)
	res = do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/compact", "", nil)
	wantStatus(t, res, http.StatusBadRequest)
}

func TestDeleteChat(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "55555555-5555-5555-5555-555555555555"

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "YQ=="))

	res := do(t, srv, "alice", "DELETE", "/v1/chats/"+chatID, "", map[string]string{"X-Expected-Seq": "1"})
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	var chats []store.ChatMeta
	if err := json.NewDecoder(res.Body).Decode(&chats); err != nil || len(chats) != 1 || !chats[0].Deleted || chats[0].HeadSeq != 2 {
		t.Fatalf("expected deletion cursor: %+v (%v)", chats, err)
	}
}

func TestChatDeletionRejectsStaleVersionsAndPreservesRecreatedLogs(t *testing.T) {
	srv := protectedTestServer(t)
	path := "/v1/chats/chat-delete-safe"
	appendEvents(t, srv, "alice", "chat-delete-safe", 0, event("e1", "YQ=="), event("e2", "Yg=="))
	for _, headers := range []map[string]string{nil, {"X-Expected-Seq": "-1"}, {"X-Expected-Seq": "invalid"}} {
		wantStatus(t, do(t, srv, "alice", "DELETE", path, "", headers), http.StatusBadRequest)
	}
	// An offline deletion at head 1 must not erase a subsequent append at head 2.
	wantStatus(t, do(t, srv, "alice", "DELETE", path, "", map[string]string{"X-Expected-Seq": "1"}), http.StatusPreconditionFailed)
	res := do(t, srv, "alice", "GET", path+"/events", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); !strings.Contains(body, `"seq":2`) {
		t.Fatalf("stale deletion removed newer events: %s", body)
	}
	for range 2 {
		wantStatus(t, do(t, srv, "alice", "DELETE", path, "", map[string]string{"X-Expected-Seq": "2"}), http.StatusNoContent)
	}
	wantStatus(t, do(t, srv, "alice", "GET", path+"/events", "", nil), http.StatusNotFound)
	wantStatus(t, do(t, srv, "alice", "POST", path+"/events", event("stale", "Yw=="), map[string]string{"X-Expected-Seq": "2"}), http.StatusConflict)
	// Recreation starts above the tombstone, rather than reusing sequence 1.
	recreated := appendEvents(t, srv, "alice", "chat-delete-safe", 3, event("new", "ZA=="))
	if recreated.NewSeq != 4 {
		t.Fatalf("recreated head = %d, want 4", recreated.NewSeq)
	}
	// A retried old deletion (lost acknowledgement) cannot erase the replacement.
	wantStatus(t, do(t, srv, "alice", "DELETE", path, "", map[string]string{"X-Expected-Seq": "2"}), http.StatusPreconditionFailed)
	res = do(t, srv, "alice", "GET", path+"/events?fromSeq=2", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); !strings.Contains(body, `"seq":4`) || strings.Contains(body, `"seq":1`) {
		t.Fatalf("replacement log: %s", body)
	}
}

func TestBlobLifecycle(t *testing.T) {
	srv := protectedTestServer(t)
	blobID := "66666666-6666-6666-6666-666666666666"

	res := do(t, srv, "alice", "HEAD", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusNotFound)

	res = do(t, srv, "alice", "PUT", "/v1/blobs/"+blobID, "encrypted-bytes", nil)
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "HEAD", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusOK)

	res = do(t, srv, "alice", "GET", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); body != "encrypted-bytes" {
		t.Fatalf("unexpected blob body: %q", body)
	}

	res = do(t, srv, "alice", "DELETE", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusNoContent)
	res = do(t, srv, "alice", "GET", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusNotFound)
	// idempotent
	res = do(t, srv, "alice", "DELETE", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusNoContent)
}

func TestUserIsolation(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "77777777-7777-7777-7777-777777777777"
	blobID := "88888888-8888-8888-8888-888888888888"

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "YQ=="))
	res := do(t, srv, "alice", "PUT", "/v1/blobs/"+blobID, "secret", nil)
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "bob", "GET", "/v1/chats", "", nil)
	if body := strings.TrimSpace(readBody(t, res)); body != "[]" {
		t.Fatalf("bob must not see alice's chats: %s", body)
	}
	res = do(t, srv, "bob", "GET", "/v1/blobs/"+blobID, "", nil)
	wantStatus(t, res, http.StatusNotFound)
	res = do(t, srv, "bob", "GET", "/v1/chats/"+chatID+"/events", "", nil)
	wantStatus(t, res, http.StatusNotFound)
}

func TestFileLifecycle(t *testing.T) {
	srv := protectedTestServer(t)
	fileID := strings.Repeat("a", 64)

	res := do(t, srv, "alice", "GET", "/v1/files", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := strings.TrimSpace(readBody(t, res)); body != "[]" {
		t.Fatalf("empty store should list []: %s", body)
	}

	res = do(t, srv, "alice", "PUT", "/v1/files/"+fileID, "cipher-v1", map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusNoContent)
	etag := strings.Trim(res.Header.Get("ETag"), `"`)
	if etag == "" {
		t.Fatal("PUT must return an ETag")
	}

	// create-only again → 412
	res = do(t, srv, "alice", "PUT", "/v1/files/"+fileID, "cipher-v2", map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusPreconditionFailed)
	// stale etag → 412
	res = do(t, srv, "alice", "PUT", "/v1/files/"+fileID, "cipher-v2", map[string]string{"If-Match": `"bogus"`})
	wantStatus(t, res, http.StatusPreconditionFailed)
	// current etag → accepted
	res = do(t, srv, "alice", "PUT", "/v1/files/"+fileID, "cipher-v2", map[string]string{"If-Match": `"` + etag + `"`})
	wantStatus(t, res, http.StatusNoContent)
	etag2 := strings.Trim(res.Header.Get("ETag"), `"`)

	res = do(t, srv, "alice", "GET", "/v1/files/"+fileID, "", nil)
	wantStatus(t, res, http.StatusOK)
	if got := strings.Trim(res.Header.Get("ETag"), `"`); got != etag2 {
		t.Fatalf("GET etag %s, want %s", got, etag2)
	}
	if body := readBody(t, res); body != "cipher-v2" {
		t.Fatalf("unexpected body: %q", body)
	}

	res = do(t, srv, "alice", "GET", "/v1/files", "", nil)
	var list []store.FileMeta
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != fileID || list[0].ETag != etag2 || list[0].Size != int64(len("cipher-v2")) {
		t.Fatalf("unexpected listing: %+v", list)
	}

	// isolation
	res = do(t, srv, "bob", "GET", "/v1/files/"+fileID, "", nil)
	wantStatus(t, res, http.StatusNotFound)

	res = do(t, srv, "alice", "DELETE", "/v1/files/"+fileID, "", nil)
	wantStatus(t, res, http.StatusNoContent)
	res = do(t, srv, "alice", "GET", "/v1/files/"+fileID, "", nil)
	wantStatus(t, res, http.StatusNotFound)
	// idempotent
	res = do(t, srv, "alice", "DELETE", "/v1/files/"+fileID, "", nil)
	wantStatus(t, res, http.StatusNoContent)
}

func TestFrameTooLarge(t *testing.T) {
	srv := protectedTestServer(t)
	chatID := "99999999-9999-9999-9999-999999999999"

	frame := strings.Repeat("A", store.MaxFrameBytes+1)
	res := do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/events", event("e1", frame),
		map[string]string{"X-Expected-Seq": "0"})
	wantStatus(t, res, http.StatusRequestEntityTooLarge)
}

func TestBackupsRequireProtection(t *testing.T) {
	srv := newTestServer(t)
	for _, body := range []string{`{"version":2,"kid":1,"pinProtected":false,"dek":"raw"}`, `{"pinProtected":true}`, `{"passkeyProtected":true}`, `{}`, `invalid`} {
		wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", body, nil), http.StatusBadRequest)
	}
	for _, request := range []struct{ method, path string }{
		{"PUT", "/v1/files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
		{"PUT", "/v1/blobs/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"},
		{"POST", "/v1/chats/cccccccc-cccc-cccc-cccc-cccccccccccc/events"},
		{"GET", "/v1/chats"}, {"GET", "/v1/files"},
	} {
		wantStatus(t, do(t, srv, "alice", request.method, request.path, "payload", nil), http.StatusForbidden)
	}
	res := do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("protected"), map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusNoContent)
	// An older client cannot turn a protected account back into plaintext mode.
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", `{"version":2,"kid":1,"pinProtected":false,"dek":"raw"}`, map[string]string{"If-Match": res.Header.Get("ETag")}), http.StatusBadRequest)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/files", "", nil), http.StatusOK)
}

func newTestStore(t *testing.T) *onedrive.Provider {
	t.Helper()
	previous := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: &testgraph.Accounts{}}
	defer func() { http.DefaultClient = previous }()
	return onedrive.New()
}
func testStoreMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _, _ := userFromRequest(r)
		next.ServeHTTP(w, r.WithContext(onedrive.WithToken(r.Context(), user)))
	})
}
