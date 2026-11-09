package store

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
)

func forwardedToken(tid, oid, email string) string {
	payload, _ := json.Marshal(map[string]string{"tid": tid, "oid": oid, "email": email})
	return "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}
func TestStableIdentityStorageSurvivesEmailRename(t *testing.T) {
	server := newTestServer(t)
	const tid = "11111111-1111-1111-1111-111111111111"
	const oid = "22222222-2222-2222-2222-222222222222"
	key := protectedTestKey("stable identity")
	header := map[string]string{"X-Forwarded-Access-Token": forwardedToken(tid, oid, "before@example.com"), "If-None-Match": "*"}
	wantStatus(t, do(t, server, "before@example.com", "PUT", "/v1/keystore", key, header), http.StatusNoContent)
	for _, email := range []string{"before@example.com", "after@example.com"} {
		header["X-Forwarded-Access-Token"] = forwardedToken(tid, oid, email)
		response := do(t, server, email, "GET", "/v1/keystore", "", header)
		wantStatus(t, response, http.StatusOK)
		if body := readBody(t, response); body != key {
			t.Fatalf("email rename lost backup: %s", body)
		}
	}
	header["X-Forwarded-Access-Token"] = forwardedToken(tid, "33333333-3333-3333-3333-333333333333", "after@example.com")
	wantStatus(t, do(t, server, "after@example.com", "GET", "/v1/keystore", "", header), http.StatusNotFound)
}
func TestIdentityChangeKeepsLegacyBackupSeparate(t *testing.T) {
	server := newTestServer(t)
	legacyEmail := "user@example.com"
	wantStatus(t, do(t, server, legacyEmail, "PUT", "/v1/keystore", protectedTestKey("legacy"), nil), http.StatusNoContent)
	header := map[string]string{"X-Forwarded-Access-Token": forwardedToken("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", legacyEmail)}
	wantStatus(t, do(t, server, legacyEmail, "GET", "/v1/keystore", "", header), http.StatusNotFound)
	response := do(t, server, legacyEmail, "GET", "/v1/me", "", header)
	wantStatus(t, response, http.StatusOK)
	var user identity.User
	if err := json.NewDecoder(response.Body).Decode(&user); err != nil {
		t.Fatal(err)
	}
	if user.PreviousID == "" || user.PreviousID == user.ID || user.Email != legacyEmail {
		t.Fatalf("missing local migration hint: %+v", user)
	}
	legacy := do(t, server, legacyEmail, "GET", "/v1/keystore", "", nil)
	wantStatus(t, legacy, http.StatusOK)
	if !strings.Contains(readBody(t, legacy), "legacy") {
		t.Fatal("legacy backup was modified")
	}
}
func TestMalformedForwardedTokenIsUnauthorized(t *testing.T) {
	server := newTestServer(t)
	header := map[string]string{"X-Forwarded-Access-Token": "malformed"}
	wantStatus(t, do(t, server, "user@example.com", "GET", "/v1/me", "", header), http.StatusUnauthorized)
}
