package public

import (
	"net/http"
	"net/http/httptest"
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
