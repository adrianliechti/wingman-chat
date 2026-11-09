// Test-only backend: production OneDrive routes backed by an in-memory Graph service.
package main

import (
	"github.com/adrianliechti/wingman-chat/internal/testgraph"
	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server"
	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
	"net/http"
	"os"
)

func main() {
	http.DefaultClient = &http.Client{Transport: &testgraph.Accounts{}}
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive", PinSecret: "browser-test-pin-secret-0123456789abcdef"}, Drives: []config.Drive{{ID: "test", Type: "onedrive"}}}
	handler := server.New(cfg, "/api", config.PlatformURL(), "", os.DirFS("dist"), "skills")
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, ok := identity.FromRequest(r); ok {
			r.Header.Set("Authorization", "Bearer "+user.Key)
		}
		handler.ServeHTTP(w, r)
	})
	if err := http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), wrapped); err != nil {
		panic(err)
	}
}
