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

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
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

		if _, err := fs.Stat(h.dist, p); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		indexFile, err := fs.ReadFile(h.dist, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexFile)
	})
}
