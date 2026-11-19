package server

import (
	"encoding/base64"
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
		var exchanger *obo.Exchanger
		if auth := cfg.Backup.Auth; auth != nil {
			scope := auth.Scope
			if scope == "" {
				scope = "https://graph.microsoft.com/.default"
			}
			var err error
			exchanger, err = obo.New(auth.Issuer, auth.ClientID, auth.ClientSecret, scope)
			if err != nil {
				return nil, nil, err
			}
		}
		p := storeonedrive.New()
		if secret := cfg.Backup.DirectUploadKey; secret != "" {
			key, err := base64.StdEncoding.DecodeString(secret)
			if err != nil || len(key) < 32 {
				return nil, nil, fmt.Errorf("BACKUP_DIRECT_UPLOAD_KEY must be base64 encoding at least 32 bytes")
			}
			p.EnableDirectUploads(key)
		}
		middleware := func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
