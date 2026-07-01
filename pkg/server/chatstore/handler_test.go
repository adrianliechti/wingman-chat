package chatstore

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/chatstore"
	"github.com/adrianliechti/wingman-chat/pkg/chatstore/file"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	provider, err := file.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	New(provider).Attach(mux, "")

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

func appendEvents(t *testing.T, srv *httptest.Server, user, chatID string, expectedSeq int64, events ...string) chatstore.AppendResult {
	t.Helper()

	res := do(t, srv, user, "POST", "/v1/chats/"+chatID+"/events", strings.Join(events, "\n"),
		map[string]string{"X-Expected-Seq": fmt.Sprint(expectedSeq)})
	wantStatus(t, res, http.StatusOK)

	var out chatstore.AppendResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func event(id, frame string) string {
	return fmt.Sprintf(`{"id":%q,"frame":%q}`, id, frame)
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

	var u userIdentity
	if err := json.NewDecoder(res.Body).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if len(u.ID) != 32 {
		t.Fatalf("id should be 16 hashed bytes hex-encoded, got %q", u.ID)
	}

	res2 := do(t, srv, "alice", "GET", "/v1/me", "", nil)
	var u2 userIdentity
	json.NewDecoder(res2.Body).Decode(&u2)
	if u.ID != u2.ID {
		t.Fatal("identity must be stable across requests")
	}
}

func TestKeystoreLifecycle(t *testing.T) {
	srv := newTestServer(t)

	res := do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusNotFound)

	res = do(t, srv, "alice", "PUT", "/v1/keystore", `{"version":1}`, map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusNoContent)
	etag := strings.Trim(res.Header.Get("ETag"), `"`)
	if etag == "" {
		t.Fatal("PUT must return an ETag")
	}

	// create-only again → conflict
	res = do(t, srv, "alice", "PUT", "/v1/keystore", `{"version":2}`, map[string]string{"If-None-Match": "*"})
	wantStatus(t, res, http.StatusPreconditionFailed)

	// CAS with a stale etag → conflict
	res = do(t, srv, "alice", "PUT", "/v1/keystore", `{"version":2}`, map[string]string{"If-Match": `"bogus"`})
	wantStatus(t, res, http.StatusPreconditionFailed)

	// CAS with the current etag → accepted
	res = do(t, srv, "alice", "PUT", "/v1/keystore", `{"version":2}`, map[string]string{"If-Match": `"` + etag + `"`})
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := readBody(t, res); body != `{"version":2}` {
		t.Fatalf("unexpected keystore body: %s", body)
	}
}

func TestAppendAndReadEvents(t *testing.T) {
	srv := newTestServer(t)
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
	srv := newTestServer(t)
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
	srv := newTestServer(t)
	chatID := "33333333-3333-3333-3333-333333333333"

	res := do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	wantStatus(t, res, http.StatusOK)
	if body := strings.TrimSpace(readBody(t, res)); body != "[]" {
		t.Fatalf("empty store should list []: %s", body)
	}

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "ZnJhbWUx"))

	res = do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	var chats []chatstore.ChatMeta
	if err := json.NewDecoder(res.Body).Decode(&chats); err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].ID != chatID || chats[0].HeadSeq != 1 {
		t.Fatalf("unexpected chat list: %+v", chats)
	}
}

func TestCompact(t *testing.T) {
	srv := newTestServer(t)
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
	srv := newTestServer(t)
	chatID := "55555555-5555-5555-5555-555555555555"

	appendEvents(t, srv, "alice", chatID, 0, event("e1", "YQ=="))

	res := do(t, srv, "alice", "DELETE", "/v1/chats/"+chatID, "", nil)
	wantStatus(t, res, http.StatusNoContent)

	res = do(t, srv, "alice", "GET", "/v1/chats", "", nil)
	if body := strings.TrimSpace(readBody(t, res)); body != "[]" {
		t.Fatalf("chat should be gone: %s", body)
	}
}

func TestBlobLifecycle(t *testing.T) {
	srv := newTestServer(t)
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
	srv := newTestServer(t)
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
	if body := strings.TrimSpace(readBody(t, res)); body != "" {
		t.Fatalf("bob must not read alice's events: %s", body)
	}
}

func TestFrameTooLarge(t *testing.T) {
	srv := newTestServer(t)
	chatID := "99999999-9999-9999-9999-999999999999"

	frame := strings.Repeat("A", chatstore.MaxFrameBytes+1)
	res := do(t, srv, "alice", "POST", "/v1/chats/"+chatID+"/events", event("e1", frame),
		map[string]string{"X-Expected-Seq": "0"})
	wantStatus(t, res, http.StatusRequestEntityTooLarge)
}
