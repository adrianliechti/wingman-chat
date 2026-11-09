package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

func TestProtectedKeystoreValidation(t *testing.T) {
	encode := func(size int) string { return base64.StdEncoding.EncodeToString(make([]byte, size)) }
	passkey := map[string]any{
		"version": 2, "kid": 1, "pinProtected": false, "passkeyProtected": true,
		"passkey": map[string]any{"credentialId": encode(32), "rpId": "localhost", "salt": encode(32), "nonce": encode(12), "wrappedDek": encode(48)},
	}
	data, _ := json.Marshal(passkey)
	if !protectedKeystore(data) {
		t.Fatal("valid passkey rejected")
	}
	if !protectedKeystore([]byte(protectedTestKey("valid"))) {
		t.Fatal("valid PIN rejected")
	}
	var dual map[string]any
	_ = json.Unmarshal([]byte(protectedTestKey("dual")), &dual)
	dual["passkeyProtected"] = true
	dual["passkey"] = passkey["passkey"]
	dualData, _ := json.Marshal(dual)
	if !protectedKeystore(dualData) {
		t.Fatal("valid combined PIN and passkey rejected")
	}
	for _, body := range []string{
		strings.Replace(string(data), `"version":2`, `"version":1`, 1),
		strings.Replace(string(data), `"kid":1`, `"kid":0`, 1),
		strings.Replace(string(data), `"pinProtected":false`, `"pinProtected":true`, 1),
		strings.Replace(string(data), `"salt":"`+encode(32)+`"`, `"salt":"invalid"`, 1),
		strings.Replace(string(data), `"rpId":"localhost"`, `"rpId":""`, 1),
		`{"dek":null,` + string(data)[1:],
		`{"dek":"plaintext",` + string(data)[1:],
		strings.Replace(protectedTestKey("weak"), `"iter":600000`, `"iter":1`, 1),
		strings.Replace(string(dualData), `"iter":600000`, `"iter":1`, 1),
		strings.Replace(string(dualData), `"rpId":"localhost"`, `"rpId":""`, 1),
		`{"dek":null,` + string(dualData)[1:],
	} {
		if protectedKeystore([]byte(body)) {
			t.Fatalf("accepted invalid protection: %s", body)
		}
	}
}

func TestLegacyUnprotectedStoreRequiresUpgrade(t *testing.T) {
	provider := newTestStore(t)
	legacy := `{"version":2,"kid":1,"pinProtected":false,"dek":"legacy-key"}`
	etag, err := provider.PutKeystore(onedrive.WithToken(context.Background(), "alice"), "alice", []byte(legacy), "*")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(provider, testStoreMiddleware).Attach(mux, "")
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Forwarded-User", "alice")
		req.Header.Set("If-Match", `"`+etag+`"`)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		return res
	}
	if response := request("GET", "/v1/keystore", ""); response.Code != 200 || response.Body.String() != legacy {
		t.Fatal("legacy upgrade key unavailable")
	}
	if response := request("GET", "/v1/files", ""); response.Code != 403 {
		t.Fatal("legacy backup operation allowed")
	}
	if response := request("PUT", "/v1/keystore", protectedTestKey("upgrade")); response.Code != 204 {
		t.Fatalf("upgrade failed: %s", response.Body.String())
	}
	if response := request("GET", "/v1/files", ""); response.Code != 200 {
		t.Fatalf("protected operation failed: %s", response.Body.String())
	}
}
