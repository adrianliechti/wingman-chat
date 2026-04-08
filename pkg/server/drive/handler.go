package drive

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/drive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/local"
	"github.com/adrianliechti/wingman-chat/pkg/drive/onedrive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/sharepoint"
)

type driveInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Handler struct {
	drives map[string]drive.Provider
	info   []driveInfo
}

func New(cfgs []config.Drive) *Handler {
	h := &Handler{
		drives: make(map[string]drive.Provider),
	}

	for _, cfg := range cfgs {
		var p drive.Provider
		var err error

		switch cfg.Type {
		case "onedrive":
			p = onedrive.New()
		case "sharepoint":
			p, err = sharepoint.New(cfg.URL)
		default:
			p, err = local.New(cfg.Path)
		}

		if err != nil {
			fmt.Printf("drive %q: %v\n", cfg.ID, err)
			continue
		}

		h.drives[cfg.ID] = p

		h.info = append(h.info, driveInfo{
			ID:   cfg.ID,
			Name: cfg.Name,
		})
	}

	return h
}

func (h *Handler) Attach(mux *http.ServeMux, prefix string) {
	prefix = strings.TrimRight(prefix, "/")

	mux.HandleFunc("GET "+prefix+"/v1/drives", h.handleList)
	mux.HandleFunc("GET "+prefix+"/v1/drives/{id}/entries", h.handleEntries)
	mux.HandleFunc("GET "+prefix+"/v1/drives/{id}/content", h.handleContent)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.info)
}

func (h *Handler) handleEntries(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	d, ok := h.drives[id]
	if !ok {
		http.Error(w, "drive not found", http.StatusNotFound)
		return
	}

	ctx := contextWithToken(r)

	entryID := r.URL.Query().Get("id")

	entries, err := d.List(ctx, entryID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if entries == nil {
		entries = []drive.Entry{}
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

	identifier := r.URL.Query().Get("id")
	if identifier == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	ctx := contextWithToken(r)

	reader, mimeType, size, err := d.Open(ctx, identifier)
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

func contextWithToken(r *http.Request) context.Context {
	ctx := r.Context()

	var token string

	if v, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		token = v
	} else if v := r.Header.Get("X-Forwarded-Access-Token"); v != "" {
		token = v
	}

	if token != "" {
		ctx = drive.WithToken(ctx, token)
	}

	return ctx
}
