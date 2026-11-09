package store

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPinPepperEndpoint(t *testing.T) {
	request := func(h *Handler, user string) *httptest.ResponseRecorder {
		mux := http.NewServeMux()
		h.Attach(mux, "")
		req := httptest.NewRequest("GET", "/v1/keystore/pepper", nil)
		if user != "" {
			req.Header.Set("X-Forwarded-User", user)
		}
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		return res
	}
	pepper := func(res *httptest.ResponseRecorder) []byte {
		var body struct {
			Pepper string `json:"pepper"`
		}
		if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &body) != nil {
			t.Fatalf("pepper request failed: %d %s", res.Code, res.Body.String())
		}
		data, err := base64.StdEncoding.DecodeString(body.Pepper)
		if err != nil || len(data) != 32 {
			t.Fatalf("invalid pepper: %q", body.Pepper)
		}
		return data
	}

	if res := request(New(nil, nil), "alice"); res.Code != 404 {
		t.Fatalf("unconfigured pepper returned %d", res.Code)
	}
	if _, err := New(nil, nil).WithPinSecret("short"); err == nil {
		t.Fatal("short PIN secret accepted")
	}
	secret := strings.Repeat("s", MinPinSecretLength)
	h, err := New(nil, nil).WithPinSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	if res := request(h, ""); res.Code != 401 {
		t.Fatalf("anonymous pepper returned %d", res.Code)
	}
	alice := pepper(request(h, "alice"))
	if res := request(h, "alice"); res.Header().Get("Cache-Control") != "no-store" || string(pepper(res)) != string(alice) {
		t.Fatal("pepper is not stable and uncached")
	}
	if string(pepper(request(h, "bob"))) == string(alice) {
		t.Fatal("pepper shared across users")
	}
	other, _ := New(nil, nil).WithPinSecret(strings.Repeat("t", MinPinSecretLength))
	if string(pepper(request(other, "alice"))) == string(alice) {
		t.Fatal("pepper independent of secret")
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
	valid := map[string]any{"name": "argon2id", "salt": encode(16), "m": 65536, "t": 3, "p": 1, "pepper": true}
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
	if protectedKeystore(key(map[string]any{"name": "pbkdf2-sha256", "salt": encode(16), "iter": 600000, "pepper": true})) {
		t.Fatal("accepted peppered PBKDF2")
	}
}
