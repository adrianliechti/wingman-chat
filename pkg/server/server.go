package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

// New creates the HTTP handler with all routes wired up.
func New(cfg *config.Config, token string, platformURL, realtimeURL *url.URL, dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	// SPA fallback: serve index.html for routes that don't match real files
	mux.Handle("/", spaHandler(dist))

	// Dynamic config endpoint
	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg)
	})

	// Realtime proxy
	if realtimeURL != nil {
		mux.Handle("/api/v1/realtime", http.StripPrefix("/api", &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) {
				r.SetURL(realtimeURL)

				if token != "" {
					r.Out.Header.Set("Authorization", "Bearer "+token)
				}
			},
		}))
	}

	// Platform API proxy
	mux.Handle("/api/", http.StripPrefix("/api", &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(platformURL)

			if token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+token)
			}
		},
	}))

	return mux
}

// spaHandler serves static files from the given filesystem, falling back to
// index.html for paths that don't match a real file.
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServerFS(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}

		if _, err := fs.Stat(root, p); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		indexFile, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexFile)
	})
}
