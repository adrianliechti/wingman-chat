package store

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestResetBackup(t *testing.T) {
	srv := protectedTestServer(t)
	for _, user := range []string{"alice", "bob"} {
		appendEvents(t, srv, user, "chat-1234", 0, event("event-1", "encrypted"))
		wantStatus(t, do(t, srv, user, "PUT", "/v1/blobs/blob-1234", "encrypted", nil), http.StatusNoContent)
		wantStatus(t, do(t, srv, user, "PUT", "/v1/files/file-1234", "encrypted", nil), http.StatusNoContent)
	}
	key := do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, key, http.StatusOK)
	if got := key.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("keystore Cache-Control = %q, want no-store", got)
	}
	headers := map[string]string{"X-Confirm-Backup-Reset": "true", "If-Match": key.Header.Get("ETag")}
	wantStatus(t, do(t, srv, "", "DELETE", "/v1/backup", "", headers), http.StatusUnauthorized)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", nil), http.StatusBadRequest)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", map[string]string{"X-Confirm-Backup-Reset": "true"}), http.StatusPreconditionRequired)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", headers), http.StatusNoContent)
	// A retry whose first response was lost finds the confirmed backup gone.
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", headers), http.StatusPreconditionFailed)
	missing := do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, missing, http.StatusNotFound)
	if got := missing.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("missing keystore Cache-Control = %q, want no-store", got)
	}
	wantStatus(t, do(t, srv, "alice", "POST", "/v1/chats/chat-1234/events", event("late", "old-key"), nil), http.StatusForbidden)

	// Re-enrolling must reveal an empty store, including attachments and files.
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("new"), map[string]string{"If-None-Match": "*"}), http.StatusNoContent)
	for _, path := range []string{"/v1/chats", "/v1/files"} {
		res := do(t, srv, "alice", "GET", path, "", nil)
		wantStatus(t, res, http.StatusOK)
		if got := readBody(t, res); got != "[]\n" {
			t.Fatalf("%s after reset: %s", path, got)
		}
	}
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/blobs/blob-1234", "", nil), http.StatusNotFound)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/files/file-1234", "", nil), http.StatusNotFound)
	wantStatus(t, do(t, srv, "bob", "GET", "/v1/blobs/blob-1234", "", nil), http.StatusOK)
	wantStatus(t, do(t, srv, "bob", "GET", "/v1/files/file-1234", "", nil), http.StatusOK)
}

func TestBackupGenerationRejectsOldDeviceAfterReset(t *testing.T) {
	srv := newTestServer(t)
	makeKey := func(generation string) string {
		var key map[string]any
		if err := json.Unmarshal([]byte(protectedTestKey("")), &key); err != nil {
			t.Fatal(err)
		}
		key["generation"] = generation
		data, err := json.Marshal(key)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	create := map[string]string{"If-None-Match": "*"}
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", makeKey("old-generation"), create), http.StatusNoContent)
	key := do(t, srv, "alice", "GET", "/v1/keystore", "", nil)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", map[string]string{"X-Confirm-Backup-Reset": "true", "If-Match": key.Header.Get("ETag")}), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "old ciphertext", map[string]string{"X-Backup-Generation": "old-generation"}), http.StatusForbidden)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", makeKey("new-generation"), create), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "old ciphertext", map[string]string{"X-Backup-Generation": "old-generation"}), http.StatusConflict)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "new ciphertext", map[string]string{"X-Backup-Generation": "new-generation"}), http.StatusNoContent)
}

func TestResetKeepsBackupConfiguredAfterConfirmation(t *testing.T) {
	srv := protectedTestServer(t)
	confirmed := do(t, srv, "alice", "GET", "/v1/keystore", "", nil).Header.Get("ETag")
	reset := map[string]string{"X-Confirm-Backup-Reset": "true", "If-Match": confirmed}
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", reset), http.StatusNoContent)

	// Another device configures and fills a new backup.
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", protectedTestKey("new"), map[string]string{"If-None-Match": "*"}), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/files/file-1234", "new backup", nil), http.StatusNoContent)

	// The stale confirmation and a "no keystore" confirmation must both keep it.
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", reset), http.StatusPreconditionFailed)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", map[string]string{"X-Confirm-Backup-Reset": "true", "If-None-Match": "*"}), http.StatusPreconditionFailed)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", map[string]string{"X-Confirm-Backup-Reset": "unreadable"}), http.StatusPreconditionFailed)
	res := do(t, srv, "alice", "GET", "/v1/files/file-1234", "", nil)
	wantStatus(t, res, http.StatusOK)
	if got := readBody(t, res); got != "new backup" {
		t.Fatalf("new backup changed: %q", got)
	}
}
