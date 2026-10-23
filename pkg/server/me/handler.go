package me

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

type Handler struct{}

type profile struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

func New() *Handler {
	return &Handler{}
}

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /me", func(w http.ResponseWriter, r *http.Request) {
		p := profile{
			Name:  nameFromToken(r.Header.Get("X-Forwarded-Access-Token")),
			Email: r.Header.Get("X-Forwarded-User"),
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(p)
	})
}

// nameFromToken extracts the "name" claim from a JWT without verifying its
// signature. The token is issued and validated by the upstream oauth2 proxy,
// which only forwards it after authenticating the user.
func nameFromToken(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}

	var claims struct {
		Name string `json:"name"`
	}

	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}

	return claims.Name
}
