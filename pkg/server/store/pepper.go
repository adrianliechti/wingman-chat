package store

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
)

// MinPinSecretLength rejects secrets too short to resist guessing.
const MinPinSecretLength = 32

// WithPinSecret enables per-user PIN peppers. Browsers mix the pepper into PIN
// key derivation, so a leaked keystore cannot be brute-forced offline without
// this secret. Changing or losing it makes peppered PINs unusable; passkeys
// keep working.
func (h *Handler) WithPinSecret(secret string) (*Handler, error) {
	if secret == "" {
		h.pinSecret = nil
		return h, nil
	}
	if len(secret) < MinPinSecretLength {
		return nil, fmt.Errorf("backup PIN secret must be at least %d characters", MinPinSecretLength)
	}
	h.pinSecret = []byte(secret)
	return h, nil
}

func pinPepper(secret []byte, userID string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("wingman-backup-pin-pepper\x00"))
	mac.Write([]byte(userID))
	return mac.Sum(nil)
}

func (h *Handler) handlePinPepper(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if len(h.pinSecret) == 0 {
		http.Error(w, "PIN pepper not configured", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"pepper": base64.StdEncoding.EncodeToString(pinPepper(h.pinSecret, userID)),
	})
}
