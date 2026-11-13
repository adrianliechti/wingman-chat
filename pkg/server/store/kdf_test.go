package store

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

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
