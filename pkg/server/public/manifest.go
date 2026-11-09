package public

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strings"
)

// Read the deployed manifest on each request so mounted branding replacements
// take effect without a restart. Override only the configured display name;
// keep icons, install identity, colors and future manifest members intact.
func (h *Handler) serveManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", cacheRevalidate)
	filename := "manifest.json"
	if scheme := r.URL.Query().Get("color-scheme"); scheme == "light" || scheme == "dark" {
		filename = "manifest_" + scheme + ".json"
	}
	data, err := fs.ReadFile(h.dist, filename)
	if filename != "manifest.json" && errors.Is(err, fs.ErrNotExist) {
		data, err = fs.ReadFile(h.dist, "manifest.json")
	}
	if err != nil {
		http.Error(w, "manifest unavailable", http.StatusInternalServerError)
		return
	}

	var manifest map[string]json.RawMessage
	if err := json.Unmarshal(data, &manifest); err != nil || manifest == nil {
		http.Error(w, "invalid manifest", http.StatusInternalServerError)
		return
	}
	if title := strings.TrimSpace(h.config.Title); title != "" {
		name, _ := json.Marshal(title)
		manifest["name"] = name
		manifest["short_name"] = name
	}

	w.Header().Set("Content-Type", "application/manifest+json")
	if r.Method == http.MethodHead {
		return
	}
	json.NewEncoder(w).Encode(manifest)
}
