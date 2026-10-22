package public

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

func TestCacheHeadersAndSPAFallback(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":             &fstest.MapFile{Data: []byte("app shell")},
		"html-preview-sw.js":     &fstest.MapFile{Data: []byte("service worker")},
		"assets/app-abc123.js":   &fstest.MapFile{Data: []byte("bundle")},
		"pyodide/314/runtime.js": &fstest.MapFile{Data: []byte("runtime")},
	}

	mux := http.NewServeMux()
	New(&config.Config{Title: "test"}, dist).Attach(mux)

	tests := []struct {
		name       string
		path       string
		accept     string
		wantStatus int
		wantCache  string
		wantBody   string
	}{
		{
			name:       "app shell revalidates",
			path:       "/",
			accept:     "text/html",
			wantStatus: http.StatusOK,
			wantCache:  cacheRevalidate,
			wantBody:   "app shell",
		},
		{
			name:       "service worker revalidates",
			path:       "/html-preview-sw.js",
			accept:     "*/*",
			wantStatus: http.StatusOK,
			wantCache:  cacheRevalidate,
			wantBody:   "service worker",
		},
		{
			name:       "hashed asset is immutable",
			path:       "/assets/app-abc123.js",
			accept:     "*/*",
			wantStatus: http.StatusOK,
			wantCache:  cacheImmutable,
			wantBody:   "bundle",
		},
		{
			name:       "versioned runtime revalidates",
			path:       "/pyodide/314/runtime.js",
			accept:     "*/*",
			wantStatus: http.StatusOK,
			wantCache:  cacheRevalidate,
			wantBody:   "runtime",
		},
		{
			name:       "missing resource stays missing",
			path:       "/assets/old.js",
			accept:     "*/*",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "dotted SPA route gets app shell",
			path:       "/chats/example.com",
			accept:     "text/html,application/xhtml+xml",
			wantStatus: http.StatusOK,
			wantCache:  cacheRevalidate,
			wantBody:   "app shell",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			req.Header.Set("Accept", tt.accept)
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)

			if res.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", res.Code, tt.wantStatus)
			}
			if got := res.Header().Get("Cache-Control"); got != tt.wantCache {
				t.Errorf("Cache-Control = %q, want %q", got, tt.wantCache)
			}
			if tt.wantBody != "" && res.Body.String() != tt.wantBody {
				t.Errorf("body = %q, want %q", res.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestConfigRevalidates(t *testing.T) {
	mux := http.NewServeMux()
	New(&config.Config{Title: "test"}, fstest.MapFS{}).Attach(mux)

	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/config.json", nil))

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	if got := res.Header().Get("Cache-Control"); got != cacheRevalidate {
		t.Errorf("Cache-Control = %q, want %q", got, cacheRevalidate)
	}
}

func TestServeLibrary(t *testing.T) {
	dist := fstest.MapFS{
		"artifact-libraries.json":     &fstest.MapFile{Data: []byte(`{"three.js":"assets/three-abc12345.js","bad.js":"../outside.js"}`)},
		"assets/three-abc12345.js":    &fstest.MapFile{Data: []byte("window.THREE={}")},
		"assets/three-abc12345.js.br": &fstest.MapFile{Data: []byte("brotli")},
	}
	h := New(&config.Config{}, dist)

	serve := func(name, encoding string) (*httptest.ResponseRecorder, bool) {
		req := httptest.NewRequest(http.MethodGet, "/artifacts/x/.lib/"+name, nil)
		if encoding != "" {
			req.Header.Set("Accept-Encoding", encoding)
		}
		res := httptest.NewRecorder()
		return res, h.ServeLibrary(res, req, name)
	}

	res, ok := serve("three.js", "")
	if !ok || res.Body.String() != "window.THREE={}" || !strings.HasPrefix(res.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("three.js = %v %q %q", ok, res.Header().Get("Content-Type"), res.Body)
	}
	// The name is stable across builds, so the response must revalidate.
	if got := res.Header().Get("Cache-Control"); got != cacheRevalidate {
		t.Errorf("Cache-Control = %q", got)
	}

	if res, _ := serve("three.js", "br"); res.Header().Get("Content-Encoding") != "br" {
		t.Errorf("precompressed variant not used: %q", res.Header().Get("Content-Encoding"))
	}

	for _, name := range []string{"bad.js", "missing.js"} {
		if _, ok := serve(name, ""); ok {
			t.Errorf("%s was served", name)
		}
	}

	// Without a manifest (development builds) nothing is served.
	empty := New(&config.Config{}, fstest.MapFS{})
	if empty.ServeLibrary(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil), "three.js") {
		t.Error("served a library without a manifest")
	}
}

func TestServeFile(t *testing.T) {
	dist := fstest.MapFS{
		"share.html":    &fstest.MapFile{Data: []byte("<viewer>")},
		"share.html.br": &fstest.MapFile{Data: []byte("brotli")},
		"assets":        &fstest.MapFile{Mode: fs.ModeDir},
	}
	h := New(&config.Config{}, dist)

	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/artifacts/x/", nil)
	if !h.ServeFile(res, req, "share.html") || res.Body.String() != "<viewer>" || res.Header().Get("Cache-Control") != cacheRevalidate {
		t.Fatalf("share.html = %q %v", res.Body, res.Header())
	}

	for _, name := range []string{"missing.html", "assets"} {
		if h.ServeFile(httptest.NewRecorder(), req, name) {
			t.Errorf("%s was served", name)
		}
	}
}
