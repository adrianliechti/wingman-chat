package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	storesrv "github.com/adrianliechti/wingman-chat/pkg/server/store"
	storeonedrive "github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

func TestBackupProviderSelection(t *testing.T) {
	for _, provider := range []string{"", "local", "server", "onedrive", "typo"} {
		t.Run(provider, func(t *testing.T) {
			cfg := &config.Config{Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
			if provider != "" {
				cfg.Backup = &config.Backup{Provider: provider}
			}
			selected, middleware, err := backupProvider(cfg)
			if provider == "typo" || provider == "server" {
				if err == nil {
					t.Fatal("invalid provider accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if provider == "local" || provider == "" {
				if selected != nil || middleware != nil {
					t.Fatal("local backup enabled remote storage")
				}
				return
			}
			if provider == "onedrive" {
				if _, ok := selected.(*storeonedrive.Provider); !ok || middleware == nil {
					t.Fatalf("wrong provider: %T", selected)
				}
			}
		})
	}
}
func TestBackupDriveValidation(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive"}}
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("missing connection accepted")
	}
	cfg.Drives = []config.Drive{{ID: "first", Type: "onedrive"}, {ID: "second", Type: "onedrive"}}
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("ambiguous connection accepted")
	}
	cfg.Backup.Drive = "second"
	selected, err := backupDrive(cfg)
	if err != nil || selected.ID != "second" {
		t.Fatalf("explicit selection: %v %v", selected, err)
	}
	cfg.Backup.Drive = "missing"
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("unknown connection accepted")
	}
}
func TestOneDriveMiddlewareRequiresTokenAndScopesRoutes(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
	selected, middleware, err := backupProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	storesrv.New(selected, middleware).Attach(mux, "/api")
	mux.HandleFunc("GET /api/v1/models", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, test := range []struct {
		path   string
		status int
	}{{"/api/v1/me", 200}, {"/api/v1/keystore", 401}, {"/api/v1/models", 204}} {
		r := httptest.NewRequest("GET", test.path, nil)
		r.Header.Set("X-Forwarded-User", "alice")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("%s: %d %s", test.path, w.Code, w.Body.String())
		}
		if test.path == "/api/v1/me" && w.Header().Get("X-Backup-Destination") == "" {
			t.Fatal("resolved destination missing")
		}
	}
	// With no exchange configured, forwarding a Graph token reaches the provider.
	// A canceled context makes the subsequent network operation fail locally.
	for _, header := range []string{"Authorization", "X-Forwarded-Access-Token"} {
		next := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			if _, err := selected.ListChats(ctx, "alice"); err == nil || !strings.Contains(err.Error(), "context canceled") {
				t.Fatalf("token did not reach provider: %v", err)
			}
			w.WriteHeader(204)
		}))
		r := httptest.NewRequest("GET", "/api/v1/keystore", nil)
		if header == "Authorization" {
			r.Header.Set(header, "Bearer graph-token")
		} else {
			r.Header.Set(header, "graph-token")
		}
		w := httptest.NewRecorder()
		next.ServeHTTP(w, r)
		if w.Code != 204 {
			t.Fatalf("token header %s: %d", header, w.Code)
		}
	}
}
