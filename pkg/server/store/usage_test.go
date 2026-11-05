package store

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestBackupUsage(t *testing.T) {
	srv := protectedTestServer(t)
	wantStatus(t, do(t, srv, "", "GET", "/v1/backup/usage", "", nil), http.StatusUnauthorized)
	wantStatus(t, do(t, srv, "unknown", "GET", "/v1/backup/usage", "", nil), http.StatusForbidden)
	size := func(user string) int64 {
		t.Helper()
		res := do(t, srv, user, "GET", "/v1/backup/usage", "", nil)
		wantStatus(t, res, http.StatusOK)
		var usage struct {
			Bytes int64 `json:"bytes"`
		}
		if err := json.NewDecoder(res.Body).Decode(&usage); err != nil {
			t.Fatal(err)
		}
		return usage.Bytes
	}
	initial := size("alice")
	if initial <= 0 {
		t.Fatal("keystore must be included")
	}
	wantStatus(t, do(t, srv, "bob", "PUT", "/v1/blobs/blob-bob1", strings.Repeat("x", 10000), nil), http.StatusNoContent)
	if got := size("alice"); got != initial {
		t.Fatalf("other user's data counted: %d != %d", got, initial)
	}
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-alice1", "1234567890", nil), http.StatusNoContent)
	if got := size("alice"); got != initial+10 {
		t.Fatalf("blob size missing: %d", got)
	}
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/files/file-alice1", "file data", nil), http.StatusNoContent)
	afterFile := size("alice")
	if afterFile < initial+19 {
		t.Fatal("file size missing")
	}
	appendEvents(t, srv, "alice", "chat-alice1", 0, event("event1", "ZW5jcnlwdGVk"))
	if got := size("alice"); got <= afterFile {
		t.Fatal("chat size missing")
	}
}
