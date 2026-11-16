// Package identity reads the user identity forwarded by the authenticating
// reverse proxy. The proxy must authenticate the session, overwrite incoming
// X-Forwarded-* headers, and be the only route to this backend.
package identity

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

// User is served by /me. ID is a hash of X-Forwarded-User, so the raw proxy
// subject is never exposed to the browser.
type User struct {
	ID string `json:"id"`
}

func FromRequest(r *http.Request) (User, bool) {
	subject := strings.TrimSpace(r.Header.Get("X-Forwarded-User"))
	if subject == "" {
		return User{}, false
	}
	sum := sha256.Sum256([]byte(subject))
	return User{ID: hex.EncodeToString(sum[:16])}, true
}
