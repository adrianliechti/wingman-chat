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
	headers := map[string]string{"X-Confirm-Backup-Reset": "true"}
	wantStatus(t, do(t, srv, "", "DELETE", "/v1/backup", "", headers), http.StatusUnauthorized)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", nil), http.StatusBadRequest)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/keystore", "", nil), http.StatusOK)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", headers), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", headers), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/keystore", "", nil), http.StatusNotFound)
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
		key["backup"] = map[string]string{"generation": generation, "publicKey": "public", "encryptedPrivateKey": "encrypted"}
		data, err := json.Marshal(key)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", makeKey("old-generation"), nil), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/backup", "", map[string]string{"X-Confirm-Backup-Reset": "true"}), http.StatusNoContent)
	var incomplete map[string]any
	if err := json.Unmarshal([]byte(protectedTestKey("")), &incomplete); err != nil {
		t.Fatal(err)
	}
	delete(incomplete, "backup")
	setupKey, _ := json.Marshal(incomplete)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", string(setupKey), nil), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "old ciphertext", map[string]string{"X-Backup-Generation": "old-generation"}), http.StatusConflict)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/keystore", makeKey("new-generation"), nil), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "old ciphertext", map[string]string{"X-Backup-Generation": "old-generation"}), http.StatusConflict)
	wantStatus(t, do(t, srv, "alice", "PUT", "/v1/blobs/blob-1234", "new ciphertext", map[string]string{"X-Backup-Generation": "new-generation"}), http.StatusNoContent)
}
