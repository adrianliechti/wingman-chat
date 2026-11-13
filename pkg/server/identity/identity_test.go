package identity

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

const tenant = "8cbd52dc-3264-4ee0-8d0b-3560fe959c06"
const objectID = "120d707b-2401-487c-86f5-685ed2d48040"

func jwt(claims any) string {
	payload, _ := json.Marshal(claims)
	return "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}
func TestStableEntraIdentitySurvivesEmailChange(t *testing.T) {
	var before User
	for i, email := range []string{"before@example.com", "after@example.com"} {
		request := httptest.NewRequest("GET", "/api/v1/me", nil)
		request.Header.Set("X-Forwarded-User", email)
		request.Header.Set("X-Forwarded-Access-Token", jwt(map[string]any{"tid": tenant, "oid": objectID, "email": email}))
		user, ok := FromRequest(request)
		if !ok || user.Key != tenant+":"+objectID || user.ID != hash(tenant+":"+objectID) || user.Email != email || user.PreviousID != hash(email) {
			t.Fatalf("identity: %+v %v", user, ok)
		}
		if i == 0 {
			before = user
		} else if user.ID != before.ID || user.Key != before.Key {
			t.Fatal("email change changed storage identity")
		}
	}
}
func TestCanonicalIdentityAndTenantIsolation(t *testing.T) {
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("X-Forwarded-Access-Token", jwt(map[string]any{"tid": strings.ToUpper(tenant), "oid": strings.ToUpper(objectID)}))
	first, ok := FromRequest(request)
	if !ok || first.Key != tenant+":"+objectID {
		t.Fatalf("canonical identity: %+v", first)
	}
	request.Header.Set("X-Forwarded-Access-Token", jwt(map[string]any{"tid": "00000000-0000-0000-0000-000000000001", "oid": objectID}))
	other, ok := FromRequest(request)
	if !ok || other.ID == first.ID {
		t.Fatal("tenants share backup identity")
	}
}
func TestInvalidForwardedIdentityDoesNotFallBackToEmail(t *testing.T) {
	for _, token := range []string{
		"malformed", "header.!.signature", strings.Repeat("a", (128<<10)+1),
		jwt(map[string]any{"tid": tenant}), jwt(map[string]any{"oid": objectID}),
		jwt(map[string]any{"tid": "invalid", "oid": objectID}),
		jwt(map[string]any{"tid": tenant, "oid": 42}),
		jwt(map[string]any{"tid": "", "oid": ""}),
		jwt(map[string]any{"tid": nil, "oid": nil}),
		jwt(map[string]any{"tid": nil}),
		jwt(nil), jwt([]string{"not an object"}),
	} {
		request := httptest.NewRequest("GET", "/", nil)
		request.Header.Set("X-Forwarded-User", "user@example.com")
		request.Header.Set("X-Forwarded-Access-Token", token)
		if _, ok := FromRequest(request); ok {
			t.Fatal("invalid forwarded identity fell back to email")
		}
	}
}
func TestHeaderIdentityRemainsAvailableWithoutEntraClaims(t *testing.T) {
	for _, token := range []string{"", jwt(map[string]string{"sub": "generic-oidc-subject", "email": "user@example.com"})} {
		request := httptest.NewRequest("GET", "/", nil)
		request.Header.Set("X-Forwarded-User", " alice ")
		if token != "" {
			request.Header.Set("X-Forwarded-Access-Token", token)
		}
		request.Header.Set("Authorization", "Bearer "+jwt(map[string]any{"tid": tenant, "oid": objectID}))
		user, ok := FromRequest(request)
		if !ok || user.Key != "alice" || user.ID != hash("alice") || user.PreviousID != "" {
			t.Fatalf("header identity: %+v %v", user, ok)
		}
	}
}
