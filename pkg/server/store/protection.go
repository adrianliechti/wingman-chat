package store

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// Validate the key envelope, never the encrypted contents or the user's secret.
func protectedKeystore(data []byte) bool {
	var key struct {
		Version          int             `json:"version"`
		Kid              int             `json:"kid"`
		AccountID        string          `json:"accountId"`
		DEK              json.RawMessage `json:"dek"`
		PIN              bool            `json:"pinProtected"`
		PasskeyProtected bool            `json:"passkeyProtected"`
		Wrapped          string          `json:"wrappedDek"`
		Nonce            string          `json:"nonce"`
		KDF              struct {
			Name   string `json:"name"`
			Salt   string `json:"salt"`
			Memory int    `json:"m"`
			Time   int    `json:"t"`
			Lanes  int    `json:"p"`
		} `json:"kdf"`
		Passkey struct {
			CredentialID string `json:"credentialId"`
			RPID         string `json:"rpId"`
			Salt         string `json:"salt"`
			Nonce        string `json:"nonce"`
			Wrapped      string `json:"wrappedDek"`
		} `json:"passkey"`
	}
	if json.Unmarshal(data, &key) != nil || key.Version != 2 || key.Kid < 1 || key.Kid > 255 || len(key.DEK) != 0 || (!key.PIN && !key.PasskeyProtected) {
		return false
	}
	if !accountID.MatchString(key.AccountID) {
		return false
	}
	if key.PIN {
		if !sizedBase64(key.Wrapped, 48) || !sizedBase64(key.Nonce, 12) || !sizedBase64(key.KDF.Salt, 16) {
			return false
		}
		// Mirrors the browser's accepted range: at least OWASP's minimum, at most 256 MiB.
		if key.KDF.Name != "argon2id" || key.KDF.Memory < 19*1024 || key.KDF.Memory > 256*1024 || key.KDF.Time < 2 || key.KDF.Time > 16 || key.KDF.Lanes < 1 || key.KDF.Lanes > 8 {
			return false
		}
	}
	if key.PasskeyProtected {
		id, err := base64.StdEncoding.DecodeString(key.Passkey.CredentialID)
		if err != nil || len(id) == 0 || len(id) > 1024 || strings.TrimSpace(key.Passkey.RPID) == "" || !sizedBase64(key.Passkey.Salt, 32) || !sizedBase64(key.Passkey.Nonce, 12) || !sizedBase64(key.Passkey.Wrapped, 48) {
			return false
		}
	}
	return true
}

// accountId is random and bound into all ciphertext; see keystore.ts.
var accountID = regexp.MustCompile(`^[0-9a-f]{32}$`)

func sizedBase64(value string, size int) bool {
	data, err := base64.StdEncoding.DecodeString(value)
	return err == nil && len(data) == size
}

// Backup operations require a protected keystore and the caller's current
// backup generation, which fences devices from before a reset.
func (h *Handler) requireProtection(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, _, err := h.store.GetKeystore(r.Context())
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		if err != nil || !protectedKeystore(key) {
			http.Error(w, "Set a PIN or passkey to enable backups", http.StatusForbidden)
			return
		}
		var envelope struct {
			Backup struct {
				Generation string `json:"generation"`
			} `json:"backup"`
		}
		_ = json.Unmarshal(key, &envelope)
		if envelope.Backup.Generation == "" || r.Header.Get("X-Backup-Generation") != envelope.Backup.Generation {
			http.Error(w, "Backup changed. Reload and unlock before syncing", http.StatusConflict)
			return
		}
		next(w, r)
	}
}
