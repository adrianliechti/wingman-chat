package server

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/drive/obo"
	"github.com/adrianliechti/wingman-chat/pkg/store"
	storeonedrive "github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

// backupProvider returns a nil provider for local (browser-only) backups.
// config.Load defaults an empty provider to "local"; no backup section at all
// also means local.
func backupProvider(cfg *config.Config) (store.Provider, func(http.Handler) http.Handler, error) {
	if cfg.Backup == nil {
		return nil, nil, nil
	}
	switch provider := cfg.Backup.Provider; provider {
	case "local":
		return nil, nil, nil
	case "onedrive":
		connection, err := backupDrive(cfg)
		if err != nil {
			return nil, nil, err
		}
		var exchanger *obo.Exchanger
		if auth := connection.Auth; auth != nil {
			scope := auth.Scope
			if scope == "" {
				scope = "https://graph.microsoft.com/.default"
			}
			exchanger, err = obo.New(auth.Issuer, auth.ClientID, auth.ClientSecret, scope)
			if err != nil {
				return nil, nil, err
			}
		}
		p := storeonedrive.New()
		identity := connection.ID
		if connection.Auth != nil {
			identity += "\x00" + connection.Auth.Issuer + "\x00" + connection.Auth.ClientID
		}
		destination := fmt.Sprintf("onedrive-%x", sha256.Sum256([]byte(identity)))
		middleware := func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// /me establishes the crypto account identity without accessing OneDrive.
				if strings.HasSuffix(r.URL.Path, "/v1/me") {
					w.Header().Set("X-Backup-Destination", destination)
					w.Header().Set("Cache-Control", "no-store")
					next.ServeHTTP(w, r)
					return
				}
				token := ""
				if value, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
					token = value
				}
				if token == "" {
					token = r.Header.Get("X-Forwarded-Access-Token")
				}
				if token == "" {
					http.Error(w, "OneDrive backup requires a Microsoft access token", http.StatusUnauthorized)
					return
				}
				if exchanger != nil {
					exchanged, exchangeErr := exchanger.Token(r.Context(), token)
					if exchangeErr != nil {
						http.Error(w, "OneDrive backup authorization failed. Reconnect your Microsoft account", http.StatusUnauthorized)
						return
					}
					token = exchanged
				}
				next.ServeHTTP(w, r.WithContext(storeonedrive.WithToken(r.Context(), token)))
			})
		}
		return p, middleware, nil
	default:
		return nil, nil, fmt.Errorf("unsupported backup provider %q (expected local or onedrive)", provider)
	}
}

func backupDrive(cfg *config.Config) (*config.Drive, error) {
	id := ""
	if cfg.Backup != nil {
		id = cfg.Backup.Drive
	}
	var selected *config.Drive
	for i := range cfg.Drives {
		candidate := &cfg.Drives[i]
		if candidate.Type != "onedrive" || (id != "" && candidate.ID != id) {
			continue
		}
		if selected != nil {
			return nil, fmt.Errorf("backup.drive is required when multiple OneDrive connections exist")
		}
		selected = candidate
	}
	if selected == nil {
		return nil, fmt.Errorf("OneDrive backup requires a matching onedrive connection in drives.yaml")
	}
	return selected, nil
}
