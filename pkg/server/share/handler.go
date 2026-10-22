package share

import (
	"bytes"
	"encoding/json"
	"errors"
	"html"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

// Shared pages run on the app's origin, so every file response is a CSP
// sandbox without allow-same-origin: the page gets an opaque origin and cannot
// reach the viewer's chats, storage or cookies. The viewer frames it with the
// same flags.
const sandboxPolicy = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"

// HTML documents are buffered to add the storage shim and SDK; larger pages are served as stored.
const maxInjectSize = 32 << 20

const (
	// viewerPage is the app; its /artifacts/{id} route frames the shared page.
	viewerPage = "index.html"
	// sdkPath serves `window.wingman` to framed pages, as in the app's preview.
	sdkPath = "__wingman__/sdk.js"
)

// Assets serves files from the app build.
type Assets interface {
	// ServeLibrary answers with a bundled library (`three.js`, …) or the SDK.
	ServeLibrary(w http.ResponseWriter, r *http.Request, name string) bool
	// ServeFile answers with a file of the build, such as the app's index.html.
	ServeFile(w http.ResponseWriter, r *http.Request, name string) bool
}

// Capabilities is what `window.wingman` offers a shared page through the
// viewer: AI helpers as the person viewing, the share's files read-only, a
// store for the visit and SQL. Helpers that save files and chat tools stay in
// the app.
type Capabilities struct {
	LLM        bool `json:"llm"`
	Vision     bool `json:"vision"`
	OCR        bool `json:"ocr"`
	Translate  bool `json:"translate"`
	Render     bool `json:"render"`
	Synthesize bool `json:"synthesize"`
	Transcribe bool `json:"transcribe"`
	Files      bool `json:"files"`
	Store      bool `json:"store"`
	Tools      bool `json:"tools"`
	DuckDB     bool `json:"duckdb"`
}

type Handler struct {
	store  *Store
	assets Assets

	bridge       bool
	capabilities Capabilities
}

func New(cfg *config.Config, assets Assets) *Handler {
	share := cfg.Artifacts.Share
	bridge := cfg.Artifacts.Bridge == nil || *cfg.Artifacts.Bridge

	return &Handler{
		store:  NewStore(share.Path, time.Duration(share.RetentionDays)*24*time.Hour, share.MaxSize),
		assets: assets,

		bridge: bridge,
		capabilities: Capabilities{
			LLM:        bridge,
			Vision:     bridge && cfg.Vision != nil,
			OCR:        bridge && cfg.Extractor != nil,
			Translate:  bridge && cfg.Translator != nil,
			Transcribe: bridge && cfg.STT != nil,
			Files:      bridge,
			Store:      bridge,
			DuckDB:     bridge && (cfg.Artifacts.DuckDB == nil || *cfg.Artifacts.DuckDB),
		},
	}
}

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.HandleFunc("POST /artifacts", h.handleCreate)
	mux.HandleFunc("GET /artifacts/{id}", h.handleViewer)
	mux.HandleFunc("GET /artifacts/{id}/{$}", h.handleSlash)
	mux.HandleFunc("GET /artifacts/{id}/share.json", h.handleManifest)
	mux.HandleFunc("GET /artifacts/{id}/files/{path...}", h.handleFile)
	mux.HandleFunc("GET /artifacts/{id}/{path...}", h.handleNotFound)
}

// StartSweeper removes expired shares now and then every interval.
func (h *Handler) StartSweeper(interval time.Duration) {
	go func() {
		for {
			h.store.Sweep()
			time.Sleep(interval)
		}
	}()
}

type createResponse struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Entry     string    `json:"entry"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	// A non-simple content type forces a CORS preflight, and Fetch Metadata
	// rejects cross-site posts (including from shared pages, whose origin is opaque).
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		http.Error(w, "cross-site uploads are not allowed", http.StatusForbidden)
		return
	}

	if mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType != "application/zip" {
		http.Error(w, "the upload must be application/zip", http.StatusUnsupportedMediaType)
		return
	}

	share, err := h.store.Create(r.Body, r.URL.Query().Get("entry"), r.Header.Get("X-Forwarded-User"))

	var archiveErr ArchiveError
	switch {
	case errors.Is(err, ErrTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		return
	case errors.As(err, &archiveErr):
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	case err != nil:
		http.Error(w, "the share could not be stored", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusCreated)

	json.NewEncoder(w).Encode(createResponse{
		ID:        share.ID,
		URL:       viewerURL(share.ID),
		Entry:     share.Entry,
		ExpiresAt: h.store.ExpiresAt(share),
	})
}

func (h *Handler) handleSlash(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, viewerURL(r.PathValue("id")), http.StatusMovedPermanently)
}

// handleViewer serves the app, whose /artifacts/{id} route reads share.json and frames the page.
func (h *Handler) handleViewer(w http.ResponseWriter, r *http.Request) {
	setViewerHeaders(w)

	if _, _, err := h.store.Get(r.PathValue("id")); err != nil {
		writeUnavailable(w)
		return
	}

	if h.assets == nil || !h.assets.ServeFile(w, r, viewerPage) {
		http.Error(w, "the viewer is missing from this build", http.StatusInternalServerError)
	}
}

type manifest struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Entry        string       `json:"entry"`
	ExpiresAt    time.Time    `json:"expiresAt"`
	Files        []string     `json:"files"`
	Capabilities Capabilities `json:"capabilities"`
}

func (h *Handler) handleManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")

	share, files, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// The page's `wingman.files.list()` and the names SQL can query.
	paths := []string{}
	fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() {
			paths = append(paths, name)
		}
		return nil
	})
	sort.Strings(paths)

	title := share.Title
	if title == "" {
		title = strings.TrimSuffix(path.Base(share.Entry), path.Ext(share.Entry))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(manifest{
		ID:           share.ID,
		Title:        title,
		Entry:        share.Entry,
		ExpiresAt:    h.store.ExpiresAt(share),
		Files:        paths,
		Capabilities: h.capabilities,
	})
}

func (h *Handler) handleNotFound(w http.ResponseWriter, r *http.Request) {
	setSandboxHeaders(w)
	http.NotFound(w, r)
}

func (h *Handler) handleFile(w http.ResponseWriter, r *http.Request) {
	setSandboxHeaders(w)
	// Navigations and fetches of the same URL get different answers.
	w.Header().Set("Vary", "Sec-Fetch-Dest")

	id := r.PathValue("id")

	share, files, err := h.store.Get(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	name := r.PathValue("path")
	dest := r.Header.Get("Sec-Fetch-Dest")

	// Files are shown in the viewer's frame, not browsed: opening one in a tab
	// leads to the viewer, on that page when it is one.
	if dest == "document" {
		target := viewerURL(id)
		if isHTML(name) {
			target += "?page=" + url.QueryEscape(name)
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}

	// Relative URLs only resolve from the entry's own folder.
	if name == "" {
		if strings.Contains(share.Entry, "/") {
			target := url.URL{Path: "/artifacts/" + id + "/files/" + share.Entry}
			http.Redirect(w, r, target.EscapedPath(), http.StatusFound)
			return
		}

		name = share.Entry
	}

	if name == sdkPath {
		if !h.bridge || h.assets == nil || !h.assets.ServeLibrary(w, r, sdkPath) {
			http.NotFound(w, r)
		}
		return
	}

	if library := libraryName(name); library != "" && h.assets != nil && h.assets.ServeLibrary(w, r, library) {
		return
	}

	if strings.HasSuffix(name, "/") {
		name += "index.html"
	}

	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}

	info, err := fs.Stat(files, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if info.IsDir() {
		target := url.URL{Path: r.URL.Path + "/"}
		http.Redirect(w, r, target.EscapedPath(), http.StatusMovedPermanently)
		return
	}

	f, err := files.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	content, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "file is not seekable", http.StatusInternalServerError)
		return
	}

	if contentType := contentTypeOf(name); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	// Only documents get the shim and SDK; `wingman.files.readText` and fetch() read the page as stored.
	rendered := dest == "" || dest == "iframe" || dest == "frame" || dest == "embed" || dest == "object"

	if rendered && isHTML(name) && info.Size() <= maxInjectSize {
		data, err := io.ReadAll(content)
		if err != nil {
			http.Error(w, "file could not be read", http.StatusInternalServerError)
			return
		}

		head := storageShim
		if h.bridge {
			head += h.sdkTag(id, name)
		}

		// No modification time: the served bytes change with the injected head, not with the file.
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(injectHead(data, head)))
		return
	}

	http.ServeContent(w, r, name, info.ModTime(), content)
}

// sdkTag loads `window.wingman` before the page's scripts. The token routes
// RPCs to the viewer; it secures nothing, the viewer only answers its own frame.
func (h *Handler) sdkTag(id, name string) string {
	capabilities, _ := json.Marshal(h.capabilities)

	return `<script src="/artifacts/` + id + `/files/` + sdkPath + `"` +
		` data-token="` + id + `"` +
		` data-path="` + html.EscapeString("/"+name) + `"` +
		` data-capabilities="` + html.EscapeString(string(capabilities)) + `"></script>`
}

func viewerURL(id string) string {
	return "/artifacts/" + id
}

func setSandboxHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", sandboxPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	// The opaque origin makes every fetch of a sibling file cross-origin.
	h.Set("Access-Control-Allow-Origin", "*")
	// The link is the secret; keep it out of Referer headers and search indexes.
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("Cache-Control", "no-cache")
}

// The viewer is the app on its own origin; it is not sandboxed itself.
func setViewerHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("Cache-Control", "no-cache")
}

const unavailablePage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link unavailable</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:14px/1.5 system-ui,sans-serif;color:#737373;background:#fafafa}@media (prefers-color-scheme:dark){body{color:#a3a3a3;background:#0a0a0a}}</style></head><body><p>This link has expired or does not exist.</p></body></html>`

func writeUnavailable(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	io.WriteString(w, unavailablePage)
}

var libraryPattern = regexp.MustCompile(`(?:^|/)\.lib/([^/]+)$`)

// libraryName matches `.lib/<name>` at any depth, like the preview worker.
func libraryName(name string) string {
	if m := libraryPattern.FindStringSubmatch(name); m != nil {
		return m[1]
	}
	return ""
}

func isHTML(name string) bool {
	ext := strings.ToLower(path.Ext(name))
	return ext == ".html" || ext == ".htm"
}

// Types Go's built-in table lacks; with nosniff, a missing or guessed type can
// keep a resource from loading.
var contentTypes = map[string]string{
	".txt":     "text/plain; charset=utf-8",
	".md":      "text/plain; charset=utf-8",
	".csv":     "text/csv; charset=utf-8",
	".tsv":     "text/tab-separated-values; charset=utf-8",
	".jsonl":   "application/x-ndjson",
	".ndjson":  "application/x-ndjson",
	".geojson": "application/geo+json",
	".map":     "application/json",
	".ico":     "image/x-icon",
	".bmp":     "image/bmp",
	".mp3":     "audio/mpeg",
	".wav":     "audio/wav",
	".ogg":     "audio/ogg",
	".m4a":     "audio/mp4",
	".flac":    "audio/flac",
	".mp4":     "video/mp4",
	".webm":    "video/webm",
	".mov":     "video/quicktime",
	".woff":    "font/woff",
	".woff2":   "font/woff2",
	".ttf":     "font/ttf",
	".otf":     "font/otf",
	".glb":     "model/gltf-binary",
	".gltf":    "model/gltf+json",
	".parquet": "application/vnd.apache.parquet",
}

func contentTypeOf(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if t, ok := contentTypes[ext]; ok {
		return t
	}
	return mime.TypeByExtension(ext)
}

// A sandboxed document has an opaque origin, where reading localStorage or
// sessionStorage throws. Pages built in the preview use them freely, so they
// get in-memory stand-ins that last for the document.
const storageShim = `<script>(function(){function m(){var d=new Map();return{get length(){return d.size},key:function(i){var k=Array.from(d.keys())[i];return k===undefined?null:k},getItem:function(k){k=String(k);return d.has(k)?d.get(k):null},setItem:function(k,v){d.set(String(k),String(v))},removeItem:function(k){d.delete(String(k))},clear:function(){d.clear()}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n]}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(e){}}})})();</script>`

var (
	headTag    = regexp.MustCompile(`(?i)<head\b[^>]*>`)
	htmlTag    = regexp.MustCompile(`(?i)<html\b[^>]*>`)
	doctypeTag = regexp.MustCompile(`(?i)^\s*<!doctype\b[^>]*>`)
)

// injectHead inserts snippet so it runs before the page's own scripts,
// keeping a leading doctype first so the page stays in standards mode.
func injectHead(html []byte, snippet string) []byte {
	insert := func(at int, s string) []byte {
		out := make([]byte, 0, len(html)+len(s))
		out = append(out, html[:at]...)
		out = append(out, s...)
		return append(out, html[at:]...)
	}

	if loc := headTag.FindIndex(html); loc != nil {
		return insert(loc[1], snippet)
	}

	if loc := htmlTag.FindIndex(html); loc != nil {
		return insert(loc[1], "<head>"+snippet+"</head>")
	}

	if loc := doctypeTag.FindIndex(html); loc != nil {
		return insert(loc[1], snippet)
	}

	return insert(0, snippet)
}
