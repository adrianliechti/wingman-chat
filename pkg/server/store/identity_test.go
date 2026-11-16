package store

import (
	"net/http"
	"testing"
)

func TestStorageSurvivesEmailRename(t *testing.T) {
	server := newTestServer(t)
	key := protectedTestKey("stable identity")
	header := map[string]string{"X-Forwarded-Email": "before@example.com", "If-None-Match": "*"}
	wantStatus(t, do(t, server, "subject-123", "PUT", "/v1/keystore", key, header), http.StatusNoContent)
	for _, email := range []string{"before@example.com", "after@example.com"} {
		response := do(t, server, "subject-123", "GET", "/v1/keystore", "", map[string]string{"X-Forwarded-Email": email})
		wantStatus(t, response, http.StatusOK)
		if body := readBody(t, response); body != key {
			t.Fatalf("email rename lost backup: %s", body)
		}
	}
	wantStatus(t, do(t, server, "subject-456", "GET", "/v1/keystore", "", map[string]string{"X-Forwarded-Email": "after@example.com"}), http.StatusNotFound)
}

func TestMissingForwardedUserIsUnauthorized(t *testing.T) {
	server := newTestServer(t)
	header := map[string]string{"X-Forwarded-Email": "user@example.com"}
	wantStatus(t, do(t, server, "", "GET", "/v1/me", "", header), http.StatusUnauthorized)
}
