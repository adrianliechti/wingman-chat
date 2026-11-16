package identity

import (
	"net/http/httptest"
	"testing"
)

func TestFromRequest(t *testing.T) {
	get := func(user, email string) (User, bool) {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Forwarded-User", user)
		r.Header.Set("X-Forwarded-Email", email)
		return FromRequest(r)
	}
	alice, ok := get("alice", "before@example.com")
	if !ok || len(alice.ID) != 32 || alice.ID == "alice" {
		t.Fatalf("identity: %+v %v", alice, ok)
	}
	if padded, _ := get("  alice ", "after@example.com"); padded != alice {
		t.Fatal("whitespace or email changed identity")
	}
	if bob, _ := get("bob", "before@example.com"); bob == alice {
		t.Fatal("users share identity")
	}
	if _, ok := get("  ", "alice@example.com"); ok {
		t.Fatal("identity accepted without X-Forwarded-User")
	}
}
