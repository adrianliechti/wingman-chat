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
		strings.Replace(protectedTestKey("weak"), `"t":3`, `"t":1`, 1),
		strings.Replace(string(dualData), `"t":3`, `"t":1`, 1),
		strings.Replace(string(dualData), `"rpId":"localhost"`, `"rpId":""`, 1),
		`{"dek":null,` + string(dualData)[1:],
	} {
		if protectedKeystore([]byte(body)) {
			t.Fatalf("accepted invalid protection: %s", body)
		}
	}
}

func TestUnprotectedKeystoreBlocksBackup(t *testing.T) {
	provider := newTestStore(t)
	unprotected := `{"version":2,"kid":1,"pinProtected":false,"dek":"plain-key"}`
	if _, err := provider.PutKeystore(onedrive.WithToken(context.Background(), "alice"), "alice", []byte(unprotected), "*"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(provider, testStoreMiddleware).Attach(mux, "")
	req := httptest.NewRequest("GET", "/v1/files", nil)
	req.Header.Set("X-Forwarded-User", "alice")
	req.Header.Set("X-Backup-Generation", "test-generation")
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("unprotected backup operation allowed: %d", res.Code)
	}
}

func TestArgon2idKeystoreValidation(t *testing.T) {
	encode := func(size int) string { return base64.StdEncoding.EncodeToString(make([]byte, size)) }
	key := func(kdf map[string]any) []byte {
		data, _ := json.Marshal(map[string]any{
			"version": 2, "kid": 1, "pinProtected": true,
			"wrappedDek": encode(48), "nonce": encode(12), "kdf": kdf,
		})
		return data
	}
	valid := map[string]any{"name": "argon2id", "salt": encode(16), "m": 65536, "t": 3, "p": 1}
	if !protectedKeystore(key(valid)) {
		t.Fatal("valid Argon2id keystore rejected")
	}
	for field, value := range map[string]any{"m": 1024, "t": 1, "p": 0, "salt": encode(8), "name": "scrypt"} {
		invalid := map[string]any{}
		for k, v := range valid {
			invalid[k] = v
		}
		invalid[field] = value
		if protectedKeystore(key(invalid)) {
			t.Fatalf("accepted invalid Argon2id %s=%v", field, value)
		}
	}
	if protectedKeystore(key(map[string]any{"name": "pbkdf2-sha256", "salt": encode(16), "iter": 600000})) {
		t.Fatal("accepted PBKDF2")
	}
}
