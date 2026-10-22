package public

import (
	"encoding/json"
	"io/fs"
	"net/http"
)

// The build emits the bundled artifact libraries (three.js, echarts.js, …) and
// the page SDK (`__wingman__/sdk.js`) as content-hashed assets and lists them
// in this manifest, so pages outside the app (published workspaces) can
// reference them by stable names.
const libraryManifest = "artifact-libraries.json"

func (h *Handler) loadLibraries() {
	h.libraries = map[string]string{}

	data, err := fs.ReadFile(h.dist, libraryManifest)
	if err != nil {
		return
	}

	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return
	}

	for name, asset := range manifest {
		if fs.ValidPath(asset) {
			h.libraries[name] = asset
		}
	}
}

// ServeLibrary answers with the current build's copy of a bundled library or
// the SDK and reports false when the name is unknown. The URL is not
// content-addressed, so the response revalidates instead of being cached as
// immutable.
func (h *Handler) ServeLibrary(w http.ResponseWriter, r *http.Request, name string) bool {
	h.librariesOnce.Do(h.loadLibraries)

	asset, ok := h.libraries[name]
	if !ok {
		return false
	}

	info, err := fs.Stat(h.dist, asset)
	if err != nil || info.IsDir() {
		return false
	}

	h.serveAsset(w, r, asset, info, cacheRevalidate)
	return true
}

// ServeFile answers with a file of the build, revalidating, and reports false
// when the build lacks it.
func (h *Handler) ServeFile(w http.ResponseWriter, r *http.Request, name string) bool {
	info, err := fs.Stat(h.dist, name)
	if err != nil || info.IsDir() {
		return false
	}

	h.serveAsset(w, r, name, info, cacheRevalidate)
	return true
}
