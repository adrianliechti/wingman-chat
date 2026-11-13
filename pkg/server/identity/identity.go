// Package identity reads identity supplied by the authenticated reverse proxy.
// It does not authenticate JWTs. The proxy must validate the session, overwrite
// incoming authentication headers, and be the only route to this backend.
package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

// User is a forwarded identity. Key is the private storage key; the JSON form
// is the public identity served by /me.
type User struct {
	Key        string `json:"-"`
	ID         string `json:"id"`
	Email      string `json:"email,omitempty"`
	PreviousID string `json:"previousId,omitempty"`
}

type claims struct {
	TenantID          claim  `json:"tid"`
	ObjectID          claim  `json:"oid"`
	Email             string `json:"email"`
	PreferredUsername string `json:"preferred_username"`
}

// claim records presence separately from value: an Entra claim that is
// present but null or empty must still be rejected, not ignored.
type claim struct {
	present bool
	value   *string
}

func (c *claim) UnmarshalJSON(data []byte) error {
	c.present = true
	return json.Unmarshal(data, &c.value)
}

func (c claim) valid() bool { return c.value != nil && guid.MatchString(*c.value) }

func (c claims) entra() bool { return c.TenantID.present || c.ObjectID.present }

var guid = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// forwardedClaims decodes only the proxy's forwarded token, never a client
// Authorization header. Missing or malformed tokens are not trusted identities.
func forwardedClaims(r *http.Request) (claims, bool) {
	token := r.Header.Get("X-Forwarded-Access-Token")
	if len(token) > 128<<10 {
		return claims{}, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return claims{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims{}, false
	}
	// A pointer target stays nil for a JSON null payload, which is not an object.
	var decoded *claims
	if json.Unmarshal(payload, &decoded) != nil || decoded == nil {
		return claims{}, false
	}
	return *decoded, true
}

func hash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:16])
}

func FromRequest(r *http.Request) (User, bool) {
	legacy := strings.TrimSpace(r.Header.Get("X-Forwarded-User"))
	email := strings.TrimSpace(r.Header.Get("X-Forwarded-Email"))
	if legacy == "" {
		legacy = email
	}
	key := legacy
	previous := ""
	if r.Header.Get("X-Forwarded-Access-Token") != "" {
		claims, ok := forwardedClaims(r)
		if !ok {
			return User{}, false
		}
		// Non-Entra providers may continue using the authenticated user header.
		// A partial or invalid Entra identity must never fall back to email.
		if claims.entra() {
			if !claims.TenantID.valid() || !claims.ObjectID.valid() {
				return User{}, false
			}
			key = strings.ToLower(*claims.TenantID.value) + ":" + strings.ToLower(*claims.ObjectID.value)
			if legacy != "" && legacy != key {
				previous = hash(legacy)
			}
		}
		if email == "" {
			email = strings.TrimSpace(claims.Email)
		}
		if email == "" && strings.Contains(claims.PreferredUsername, "@") {
			email = claims.PreferredUsername
		}
	}
	if key == "" {
		return User{}, false
	}
	if email == "" && strings.Contains(legacy, "@") {
		email = legacy
	}
	return User{Key: key, ID: hash(key), Email: email, PreviousID: previous}, true
}
