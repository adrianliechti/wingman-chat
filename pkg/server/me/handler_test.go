package me

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMeHashesForwardedUser(t *testing.T) {
	mux := http.NewServeMux()
	New().Attach(mux)
	get := func(user string) map[string]string {
		r := httptest.NewRequest("GET", "/me", nil)
		if user != "" {
			r.Header.Set("X-Forwarded-User", user)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	alice := get("alice")
	if len(alice["id"]) != 32 || alice["id"] != get("  alice  ")["id"] {
		t.Fatalf("unstable id: %v", alice)
	}
	if id, ok := get("")["id"]; ok {
		t.Fatalf("anonymous request got id %q", id)
	}
}
