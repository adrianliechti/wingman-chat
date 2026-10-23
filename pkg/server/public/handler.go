package public

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

type Handler struct {
	config *config.Config
	dist   fs.FS
}

func New(cfg *config.Config, dist fs.FS) *Handler {
	return &Handler{
		config: cfg,
		dist:   dist,
	}
}

// Vite content-hashes everything under assets/, so those URLs identify their
// exact bytes and can be cached forever. Everything else revalidates: without a
// Cache-Control header browsers cache heuristically, which is how a client ends
// up mixing files from two deploys (a stale index.html asking for bundles this
// build no longer has, a cached Pyodide runtime paired with a newer loader).
// Revalidation costs a round trip and answers 304 — no bytes.
const (
	cacheImmutable  = "public, max-age=31536000, immutable"
	cacheRevalidate = "no-cache"
)

func cacheControl(p string) string {
	if strings.HasPrefix(p, "assets/") {
		return cacheImmutable
	}

	return cacheRevalidate
}

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", cacheRevalidate)
		json.NewEncoder(w).Encode(h.config)
	})

	mux.Handle("/", h.spaHandler())
}

func (h *Handler) spaHandler() http.Handler {
	fileServer := http.FileServerFS(h.dist)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}

		if info, err := fs.Stat(h.dist, p); err == nil {
			// Preserve the file server's directory handling and index redirects.
			if info.IsDir() || strings.HasSuffix(r.URL.Path, "/index.html") || (p != "index.html" && strings.HasSuffix(r.URL.Path, "/")) {
				w.Header().Set("Cache-Control", cacheControl(p))
				fileServer.ServeHTTP(w, r)
				return
			}
			h.serveAsset(w, r, p, info)
			return
		}

		// Only navigations get the app shell. Missing scripts, workers, WASM, and
		// other resources must remain 404s; serving HTML for them hides stale-cache
		// problems behind opaque parse errors. Checking Accept instead of the path
		// also preserves valid SPA routes that happen to contain a dot.
		if !strings.Contains(r.Header.Get("Accept"), "text/html") {
			http.NotFound(w, r)
			return
		}

		info, err := fs.Stat(h.dist, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}

		h.serveAsset(w, r, "index.html", info)
	})
}
