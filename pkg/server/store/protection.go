package store

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// Validate the key envelope, never the encrypted contents or the user's secret.
func protectedKeystore(data []byte) bool {
	var key struct {
		Version          int             `json:"version"`
		Kid              int             `json:"kid"`
		DEK              json.RawMessage `json:"dek"`
		PIN              bool            `json:"pinProtected"`
		PasskeyProtected bool            `json:"passkeyProtected"`
		Wrapped          string          `json:"wrappedDek"`
		Nonce            string          `json:"nonce"`
		KDF              struct {
			Name   string `json:"name"`
			Salt   string `json:"salt"`
			Iter   int    `json:"iter"`
			Memory int    `json:"m"`
			Time   int    `json:"t"`
			Lanes  int    `json:"p"`
			Pepper bool   `json:"pepper"`
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
	if key.PIN {
		if !sizedBase64(key.Wrapped, 48) || !sizedBase64(key.Nonce, 12) || !sizedBase64(key.KDF.Salt, 16) {
			return false
		}
		switch key.KDF.Name {
		case "pbkdf2-sha256":
			if key.KDF.Iter < 600000 || key.KDF.Iter > 10000000 || key.KDF.Pepper {
				return false
			}
		case "argon2id":
			// Mirrors the browser's accepted range: at least OWASP's minimum, at most 256 MiB.
			if key.KDF.Memory < 19*1024 || key.KDF.Memory > 256*1024 || key.KDF.Time < 2 || key.KDF.Time > 16 || key.KDF.Lanes < 1 || key.KDF.Lanes > 8 {
				return false
			}
		default:
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

func sizedBase64(value string, size int) bool {
	data, err := base64.StdEncoding.DecodeString(value)
	return err == nil && len(data) == size
}

// Legacy plaintext keystores remain readable for a protected upgrade, but may
// not be used for backup operations, including by an already-open old frontend.
func (h *Handler) requireProtection(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _, ok := requireUser(w, r)
		if !ok {
			return
		}
		key, _, err := h.store.GetKeystore(r.Context(), userID)
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
				PublicKey string `json:"publicKey"`
			} `json:"backup"`
		}
		_ = json.Unmarshal(key, &envelope)
		if r.Header.Get("X-Backup-Key") != envelope.Backup.PublicKey {
			http.Error(w, "Backup settings changed. Reload and unlock before syncing", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}
