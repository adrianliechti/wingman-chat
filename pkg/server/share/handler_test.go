package share

import (
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

// fakeAssets stands in for the app build: libraries and the SDK by name, plus the viewer page.
type fakeAssets struct {
	libraries map[string]string
	files     map[string]string
}

func (a fakeAssets) ServeLibrary(w http.ResponseWriter, r *http.Request, name string) bool {
	source, ok := a.libraries[name]
	if !ok {
		return false
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	io.WriteString(w, source)
	return true
}

func (a fakeAssets) ServeFile(w http.ResponseWriter, r *http.Request, name string) bool {
	source, ok := a.files[name]
	if !ok {
		return false
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, source)
	return true
}

var testAssets = fakeAssets{
	libraries: map[string]string{"three.js": "window.THREE={}", sdkPath: "window.wingman={}"},
	files:     map[string]string{viewerPage: "<viewer>"},
}

func newTestServer(t *testing.T, configure ...func(*config.Config)) (*http.ServeMux, *Handler) {
	t.Helper()

	cfg := &config.Config{Artifacts: &config.Artifacts{Share: &config.ArtifactsShare{Path: t.TempDir(), RetentionDays: 7, MaxSize: 1 << 20}}}
	for _, c := range configure {
		c(cfg)
	}

	h := New(cfg, testAssets)
	mux := http.NewServeMux()
	h.Attach(mux)

	return mux, h
}

func publish(t *testing.T, mux *http.ServeMux, entry string, entries ...zipEntry) createResponse {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/artifacts?entry="+entry, buildZip(t, entries...))
	req.Header.Set("Content-Type", "application/zip")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("publish status = %d: %s", res.Code, res.Body)
	}

	var created createResponse
	if err := json.NewDecoder(res.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}

	return created
}

// get requests path as the browser would for dest ("" sends no Fetch Metadata, like curl).
func get(mux *http.ServeMux, path string, dest ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if len(dest) > 0 {
		req.Header.Set("Sec-Fetch-Dest", dest[0])
	}
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	return res
}

func readManifest(t *testing.T, mux *http.ServeMux, created createResponse) manifest {
	t.Helper()

	res := get(mux, created.URL+"/share.json", "empty")
	if res.Code != http.StatusOK {
		t.Fatalf("share.json = %d", res.Code)
	}

	var m manifest
	if err := json.NewDecoder(res.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

var deck = []zipEntry{
	{name: "index.html", body: "<!doctype html><html><head><title> Q3 &amp; Deck </title></head><body><script src=\".lib/three.js\"></script></body></html>"},
	{name: "data/sales.csv", body: "region,amount\n"},
	{name: "docs/index.html", body: "<p>Docs</p>"},
	{name: ".lib/unknown.js", body: "uploaded"},
}

func TestViewerAndManifest(t *testing.T) {
	mux, h := newTestServer(t)
	before := time.Now()

	created := publish(t, mux, "index.html", deck...)

	if created.URL != "/artifacts/"+created.ID || created.Entry != "index.html" {
		t.Fatalf("unexpected response: %+v", created)
	}

	if created.ExpiresAt.Before(before.Add(7*24*time.Hour-time.Minute)) || created.ExpiresAt.After(time.Now().Add(7*24*time.Hour)) {
		t.Fatalf("ExpiresAt = %v", created.ExpiresAt)
	}

	// The link opens the app, which is not sandboxed itself.
	viewer := get(mux, created.URL, "document")
	if viewer.Code != http.StatusOK || viewer.Body.String() != "<viewer>" {
		t.Fatalf("viewer = %d %q", viewer.Code, viewer.Body)
	}
	if viewer.Header().Get("Content-Security-Policy") != "" || viewer.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Errorf("viewer headers = %v", viewer.Header())
	}

	if slash := get(mux, created.URL+"/", "document"); slash.Code != http.StatusMovedPermanently || slash.Header().Get("Location") != created.URL {
		t.Fatalf("trailing slash = %d %q", slash.Code, slash.Header().Get("Location"))
	}

	m := readManifest(t, mux, created)
	want := manifest{
		ID:           created.ID,
		Title:        "Q3 & Deck",
		Entry:        "index.html",
		ExpiresAt:    created.ExpiresAt,
		Files:        []string{".lib/unknown.js", "data/sales.csv", "docs/index.html", "index.html"},
		Capabilities: Capabilities{LLM: true, Files: true, Store: true, DuckDB: true},
	}
	if m.ID != want.ID || m.Title != want.Title || m.Entry != want.Entry || !m.ExpiresAt.Equal(want.ExpiresAt) ||
		strings.Join(m.Files, ",") != strings.Join(want.Files, ",") || m.Capabilities != want.Capabilities {
		t.Fatalf("manifest = %+v, want %+v", m, want)
	}

	// Anything else under the share is not served.
	if other := get(mux, created.URL+"/index.html"); other.Code != http.StatusNotFound || other.Header().Get("Content-Security-Policy") != sandboxPolicy {
		t.Fatalf("path outside files/ = %d", other.Code)
	}

	// After the retention the link is gone.
	h.store.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }

	expired := get(mux, created.URL, "document")
	if expired.Code != http.StatusNotFound || !strings.Contains(expired.Body.String(), "expired or does not exist") {
		t.Fatalf("expired viewer = %d %q", expired.Code, expired.Body)
	}
	if res := get(mux, created.URL+"/share.json"); res.Code != http.StatusNotFound {
		t.Fatalf("expired manifest = %d", res.Code)
	}
	if res := get(mux, created.URL+"/files/index.html", "iframe"); res.Code != http.StatusNotFound {
		t.Fatalf("expired file = %d", res.Code)
	}
}

func TestFramedFiles(t *testing.T) {
	mux, _ := newTestServer(t)
	created := publish(t, mux, "index.html", deck...)
	files := created.URL + "/files/"

	page := get(mux, files+"index.html", "iframe")
	if page.Code != http.StatusOK {
		t.Fatalf("framed page = %d", page.Code)
	}

	body := page.Body.String()
	sdk := `<script src="/artifacts/` + created.ID + `/files/__wingman__/sdk.js" data-token="` + created.ID + `" data-path="/index.html" data-capabilities="` +
		html.EscapeString(`{"llm":true,"vision":false,"ocr":false,"translate":false,"render":false,"synthesize":false,"transcribe":false,"files":true,"store":true,"tools":false,"duckdb":true}`) + `"></script>`
	if !strings.HasPrefix(body, "<!doctype html><html><head><script>") || !strings.Contains(body, "localStorage") || !strings.Contains(body, sdk+"<title>") {
		t.Fatalf("framed page body = %s", body)
	}

	for header, want := range map[string]string{
		"Content-Security-Policy":     sandboxPolicy,
		"X-Content-Type-Options":      "nosniff",
		"Access-Control-Allow-Origin": "*",
		"Referrer-Policy":             "no-referrer",
		"Cache-Control":               "no-cache",
		"Vary":                        "Sec-Fetch-Dest",
	} {
		if got := page.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}

	if strings.Contains(sandboxPolicy, "allow-same-origin") {
		t.Fatal("the sandbox must not grant the app's origin")
	}

	// Without Fetch Metadata (older browsers, plain HTTP) pages are treated as documents.
	if res := get(mux, files+"index.html"); !strings.Contains(res.Body.String(), "__wingman__/sdk.js") {
		t.Fatalf("page without Fetch Metadata = %s", res.Body)
	}

	// Reading a page as data returns it as stored.
	if raw := get(mux, files+"index.html", "empty"); strings.Contains(raw.Body.String(), "<script>") || !strings.HasPrefix(raw.Body.String(), "<!doctype html><html><head><title>") {
		t.Fatalf("fetched page = %s", raw.Body)
	}

	csv := get(mux, files+"data/sales.csv", "empty")
	if csv.Code != http.StatusOK || csv.Body.String() != "region,amount\n" || csv.Header().Get("Content-Type") != "text/csv; charset=utf-8" || csv.Header().Get("Content-Security-Policy") != sandboxPolicy {
		t.Fatalf("csv = %d %q %v", csv.Code, csv.Body, csv.Header())
	}

	if library := get(mux, files+".lib/three.js", "script"); library.Body.String() != "window.THREE={}" {
		t.Fatalf("library = %d %q", library.Code, library.Body)
	}

	// Unknown library names fall through to the uploaded files.
	if uploaded := get(mux, files+".lib/unknown.js", "script"); uploaded.Body.String() != "uploaded" {
		t.Fatalf("uploaded .lib file = %d %q", uploaded.Code, uploaded.Body)
	}

	if sdkScript := get(mux, files+sdkPath, "script"); sdkScript.Body.String() != "window.wingman={}" {
		t.Fatalf("sdk = %d %q", sdkScript.Code, sdkScript.Body)
	}

	if folder := get(mux, files+"docs", "iframe"); folder.Code != http.StatusMovedPermanently || folder.Header().Get("Location") != files+"docs/" {
		t.Fatalf("folder = %d %q", folder.Code, folder.Header().Get("Location"))
	}

	if index := get(mux, files+"docs/", "iframe"); index.Code != http.StatusOK || !strings.Contains(index.Body.String(), "<p>Docs</p>") {
		t.Fatalf("folder index = %d %q", index.Code, index.Body)
	}

	if missing := get(mux, files+"missing.js", "script"); missing.Code != http.StatusNotFound {
		t.Fatalf("missing file = %d", missing.Code)
	}
}

func TestFilesAreNotBrowsed(t *testing.T) {
	mux, _ := newTestServer(t)
	created := publish(t, mux, "index.html", deck...)
	files := created.URL + "/files/"

	tests := []struct{ path, want string }{
		{files + "docs/index.html", created.URL + "?page=docs%2Findex.html"},
		{files + "data/sales.csv", created.URL},
		{files + ".lib/three.js", created.URL},
		{files, created.URL},
	}

	for _, tt := range tests {
		res := get(mux, tt.path, "document")
		if res.Code != http.StatusFound || res.Header().Get("Location") != tt.want {
			t.Errorf("open %s in a tab = %d %q, want %q", tt.path, res.Code, res.Header().Get("Location"), tt.want)
		}
	}
}

func TestNestedEntryRedirects(t *testing.T) {
	mux, _ := newTestServer(t)

	created := publish(t, mux, "reports/q3%20final.html", zipEntry{name: "reports/q3 final.html", body: "<p>Q3</p>"})

	res := get(mux, created.URL+"/files/", "iframe")
	if res.Code != http.StatusFound || res.Header().Get("Location") != created.URL+"/files/reports/q3%20final.html" {
		t.Fatalf("files root = %d %q", res.Code, res.Header().Get("Location"))
	}

	if page := get(mux, created.URL+"/files/reports/q3%20final.html", "iframe"); page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<p>Q3</p>") {
		t.Fatalf("entry = %d %q", page.Code, page.Body)
	}

	// Without a <title>, the header shows the page's file name.
	if m := readManifest(t, mux, created); m.Title != "q3 final" {
		t.Fatalf("title = %q", m.Title)
	}
}

func TestBridgeConfiguration(t *testing.T) {
	off := false

	t.Run("bridge off", func(t *testing.T) {
		mux, _ := newTestServer(t, func(c *config.Config) { c.Artifacts.Bridge = &off })
		created := publish(t, mux, "index.html", deck...)

		if page := get(mux, created.URL+"/files/index.html", "iframe"); strings.Contains(page.Body.String(), sdkPath) || !strings.Contains(page.Body.String(), "localStorage") {
			t.Fatalf("page = %s", page.Body)
		}
		if sdk := get(mux, created.URL+"/files/"+sdkPath, "script"); sdk.Code != http.StatusNotFound {
			t.Fatalf("sdk = %d", sdk.Code)
		}
		if m := readManifest(t, mux, created); m.Capabilities != (Capabilities{}) {
			t.Fatalf("capabilities = %+v", m.Capabilities)
		}
	})

	t.Run("duckdb off", func(t *testing.T) {
		mux, _ := newTestServer(t, func(c *config.Config) { c.Artifacts.DuckDB = &off })
		created := publish(t, mux, "index.html", deck...)

		if m := readManifest(t, mux, created); m.Capabilities != (Capabilities{LLM: true, Files: true, Store: true}) {
			t.Fatalf("capabilities = %+v", m.Capabilities)
		}
	})

	t.Run("configured AI services", func(t *testing.T) {
		mux, _ := newTestServer(t, func(c *config.Config) {
			c.Vision = &config.Vision{}
			c.Extractor = &config.Extractor{}
			c.Translator = &config.Translator{}
			c.STT = &config.STT{}
			c.TTS = &config.TTS{}
			c.Renderer = &config.Renderer{}
		})
		created := publish(t, mux, "index.html", deck...)

		// Rendering and speech save files, so they stay off on read-only shares.
		want := Capabilities{LLM: true, Vision: true, OCR: true, Translate: true, Transcribe: true, Files: true, Store: true, DuckDB: true}
		if m := readManifest(t, mux, created); m.Capabilities != want {
			t.Fatalf("capabilities = %+v", m.Capabilities)
		}
	})
}

func TestPublishRejections(t *testing.T) {
	mux, _ := newTestServer(t)
	archive := func() io.Reader { return buildZip(t, zipEntry{name: "index.html", body: "hi"}) }

	tests := []struct {
		name        string
		contentType string
		site        string
		entry       string
		want        int
	}{
		{"cross-site", "application/zip", "cross-site", "index.html", http.StatusForbidden},
		{"same-site subdomain", "application/zip", "same-site", "index.html", http.StatusForbidden},
		{"simple content type", "text/plain", "same-origin", "index.html", http.StatusUnsupportedMediaType},
		{"missing entry", "application/zip", "same-origin", "other.html", http.StatusBadRequest},
		{"no fetch metadata", "application/zip", "", "index.html", http.StatusCreated},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/artifacts?entry="+tt.entry, archive())
			req.Header.Set("Content-Type", tt.contentType)
			if tt.site != "" {
				req.Header.Set("Sec-Fetch-Site", tt.site)
			}
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)

			if res.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", res.Code, tt.want, res.Body)
			}
		})
	}
}

func TestUnknownShare(t *testing.T) {
	mux, _ := newTestServer(t)
	const id = "0123456789abcdef0123456789abcdef"

	for _, path := range []string{"/artifacts/" + id, "/artifacts/not-an-id"} {
		if res := get(mux, path, "document"); res.Code != http.StatusNotFound || !strings.Contains(res.Body.String(), "expired or does not exist") {
			t.Errorf("%s = %d %q", path, res.Code, res.Body)
		}
	}

	for _, path := range []string{"/artifacts/" + id + "/share.json", "/artifacts/" + id + "/files/index.html", "/artifacts/not-an-id/files/index.html"} {
		if res := get(mux, path, "iframe"); res.Code != http.StatusNotFound {
			t.Errorf("%s = %d", path, res.Code)
		}
	}
}

func TestInjectHead(t *testing.T) {
	const s = "<script>x</script>"

	tests := []struct{ in, want string }{
		{"<html><head lang=en><title>t</title></head></html>", "<html><head lang=en>" + s + "<title>t</title></head></html>"},
		{"<!DOCTYPE html><HTML><body>b</body></HTML>", "<!DOCTYPE html><HTML><head>" + s + "</head><body>b</body></HTML>"},
		{"<!doctype html><title>t</title><p>x", "<!doctype html>" + s + "<title>t</title><p>x"},
		{"<header>not a head</header>", s + "<header>not a head</header>"},
		{"<p>fragment</p>", s + "<p>fragment</p>"},
	}

	for _, tt := range tests {
		if got := string(injectHead([]byte(tt.in), s)); got != tt.want {
			t.Errorf("injectHead(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
