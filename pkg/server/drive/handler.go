package drive

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	drivelib "github.com/adrianliechti/wingman-chat/pkg/drive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/local"
)

type driveInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

type Handler struct {
	drives map[string]drivelib.Provider
	info   []driveInfo
}

func New(cfgs []config.Drive) *Handler {
	h := &Handler{
		drives: make(map[string]drivelib.Provider),
	}

	for _, cfg := range cfgs {
		p, err := local.New(cfg.Path)
		if err != nil {
			fmt.Printf("drive %q: %v\n", cfg.ID, err)
			continue
		}

		h.drives[cfg.ID] = p
		h.info = append(h.info, driveInfo{
			ID:   cfg.ID,
			Name: cfg.Name,
			Icon: cfg.Icon,
		})
	}

	return h
}

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /drives", h.handleList)
	mux.HandleFunc("GET /drives/{id}/list", h.handleListEntries)
	mux.HandleFunc("GET /drives/{id}/content", h.handleContent)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.info)
}

func (h *Handler) handleListEntries(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	d, ok := h.drives[id]
	if !ok {
		http.Error(w, "drive not found", http.StatusNotFound)
		return
	}

	path := r.URL.Query().Get("path")

	entries, err := d.List(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func (h *Handler) handleContent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	d, ok := h.drives[id]
	if !ok {
		http.Error(w, "drive not found", http.StatusNotFound)
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}

	reader, mimeType, size, err := d.Open(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	defer reader.Close()

	if mimeType != "" {
		w.Header().Set("Content-Type", mimeType)
	}

	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}

	io.Copy(w, reader)
}
