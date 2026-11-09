package public

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

func TestBundledManifestColorSchemes(t *testing.T) {
	dist := os.DirFS("../../../public")
	mux := http.NewServeMux()
	New(&config.Config{Title: "Configured app"}, dist).Attach(mux)
	var shared map[string]json.RawMessage
	for _, scheme := range []string{"light", "dark", "unknown"} {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/manifest.json?color-scheme="+scheme, nil))
		if res.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", scheme, res.Code, res.Body.String())
		}
		var manifest map[string]json.RawMessage
		if err := json.Unmarshal(res.Body.Bytes(), &manifest); err != nil {
			t.Fatal(err)
		}
		if shared == nil {
			shared = manifest
		}
		for _, key := range []string{"id", "name", "short_name", "description", "start_url", "scope", "display"} {
			if !bytes.Equal(manifest[key], shared[key]) {
				t.Errorf("%s differs for %s", key, scheme)
			}
		}
		var icons []struct {
			Src     string `json:"src"`
			Type    string `json:"type"`
			Purpose string `json:"purpose"`
		}
		if err := json.Unmarshal(manifest["icons"], &icons); err != nil {
			t.Fatal(err)
		}
		if len(icons) != 2 {
			t.Fatalf("expected 192/512 PNGs for %s: %s", scheme, manifest["icons"])
		}
		for _, icon := range icons {
			if scheme == "unknown" {
				if icon.Purpose != "any" || (icon.Src != "icon.png" && icon.Src != "icon.svg") {
					t.Errorf("wrong common icon: %+v", icon)
				}
			} else if icon.Type != "image/png" || icon.Purpose != "any maskable" || !strings.Contains(icon.Src, "_"+scheme+"_") {
				t.Errorf("wrong icon for %s: %+v", scheme, icon)
			}
			if _, err := fs.Stat(dist, icon.Src); err != nil {
				t.Errorf("missing bundled icon: %v", err)
			}
		}
	}
}

func TestManifestAppliesTitleAndPreservesBranding(t *testing.T) {
	const source = `{"name":"Original","short_name":"App","id":"/stable-id","start_url":"/chat","scope":"/","display":"standalone","theme_color":"#112233","icons":[{"src":"/custom.svg","sizes":"any","purpose":"maskable"}],"future_member":{"integer":9007199254740993}}`
	dist := fstest.MapFS{
		"manifest.json": {Data: []byte(source)},
		// The transformed response must never serve an old compressed manifest.
		"manifest.json.br": {Data: []byte("stale manifest")},
	}
	for _, title := range []string{"Support \"Chat\"", ""} {
		t.Run(title, func(t *testing.T) {
			mux := http.NewServeMux()
			New(&config.Config{Title: title}, dist).Attach(mux)
			req := httptest.NewRequest(http.MethodGet, "/manifest.json", nil)
			req.Header.Set("Accept-Encoding", "br, gzip")
			req.Header.Set("If-Modified-Since", "Wed, 01 Jan 2031 00:00:00 GMT")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
			}
			if got := res.Header().Get("Content-Type"); got != "application/manifest+json" {
				t.Errorf("Content-Type = %q", got)
			}
			if got := res.Header().Get("Cache-Control"); got != cacheRevalidate {
				t.Errorf("Cache-Control = %q", got)
			}
			if got := res.Header().Get("Content-Encoding"); got != "" {
				t.Errorf("Content-Encoding = %q", got)
			}
			var got, want map[string]json.RawMessage
			if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(source), &want); err != nil {
				t.Fatal(err)
			}
			if title != "" {
				name, _ := json.Marshal(title)
				want["name"], want["short_name"] = name, name
			}
			for key, value := range want {
				if string(got[key]) != string(value) {
					t.Errorf("%s = %s, want %s", key, got[key], value)
				}
			}
		})
	}
}

func TestManifestReloadsMountedFileAndHandlesHEAD(t *testing.T) {
	dist := fstest.MapFS{"manifest.json": {Data: []byte(`{"icons":[{"src":"first.png"}]}`)}}
	mux := http.NewServeMux()
	New(&config.Config{Title: "Configured app"}, dist).Attach(mux)
	for _, icon := range []string{"first.png", "replacement.png"} {
		dist["manifest.json"].Data = []byte(`{"icons":[{"src":"` + icon + `"}]}`)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/manifest.json", nil))
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), icon) {
			t.Fatalf("manifest did not use %s: %d %s", icon, res.Code, res.Body.String())
		}
	}
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodHead, "/manifest.json", nil))
	if res.Code != http.StatusOK || res.Body.Len() != 0 || res.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatalf("unexpected HEAD response: %d %v %s", res.Code, res.Header(), res.Body.String())
	}
}

func TestDarkManifestUsesOwnBrandingAndConfiguredTitle(t *testing.T) {
	dist := fstest.MapFS{
		"manifest.json":         {Data: []byte(`{"id":"/","icons":[{"src":"light.png"}]}`)},
		"manifest_dark.json":    {Data: []byte(`{"id":"/","icons":[{"src":"dark.png"}],"background_color":"#171717"}`)},
		"manifest_dark.json.br": {Data: []byte("stale compressed manifest")},
	}
	mux := http.NewServeMux()
	New(&config.Config{Title: "Custom name"}, dist).Attach(mux)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/manifest.json?color-scheme=dark", nil)
		req.Header.Set("Accept-Encoding", "br")
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("Content-Type") != "application/manifest+json" || res.Header().Get("Cache-Control") != cacheRevalidate || res.Header().Get("Content-Encoding") != "" {
			t.Fatalf("unexpected dark manifest response: %d %v", res.Code, res.Header())
		}
		if method == http.MethodHead {
			if res.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
			continue
		}
		var got struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			ShortName  string `json:"short_name"`
			Background string `json:"background_color"`
			Icons      []struct {
				Src string `json:"src"`
			} `json:"icons"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.ID != "/" || got.Name != "Custom name" || got.ShortName != "Custom name" || got.Background != "#171717" || len(got.Icons) != 1 || got.Icons[0].Src != "dark.png" {
			t.Fatalf("unexpected dark manifest: %s", res.Body.String())
		}
	}
	delete(dist, "manifest_dark.json")
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/manifest.json?color-scheme=dark", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "light.png") {
		t.Fatalf("missing dark manifest did not fall back: %d %s", res.Code, res.Body.String())
	}
}

func TestManifestErrorsDoNotFallBackToAppHTML(t *testing.T) {
	for _, source := range []string{"missing", "invalid JSON", "null", "[]"} {
		t.Run(source, func(t *testing.T) {
			dist := fstest.MapFS{"index.html": {Data: []byte("app shell")}}
			if source != "missing" {
				dist["manifest.json"] = &fstest.MapFile{Data: []byte(source)}
			}
			mux := http.NewServeMux()
			New(&config.Config{}, dist).Attach(mux)
			req := httptest.NewRequest(http.MethodGet, "/manifest.json", nil)
			req.Header.Set("Accept", "text/html")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusInternalServerError || strings.Contains(res.Body.String(), "app shell") {
				t.Fatalf("unexpected response: %d %s", res.Code, res.Body.String())
			}
		})
	}
}

func TestMissingColorSchemeUsesCommonManifest(t *testing.T) {
	mux := http.NewServeMux()
	New(&config.Config{Title: "Configured"}, fstest.MapFS{
		"manifest.json": {Data: []byte(`{"icons":[{"src":"common.svg"}]}`)},
	}).Attach(mux)
	for _, scheme := range []string{"light", "dark"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, httptest.NewRequest(method, "/manifest.json?color-scheme="+scheme, nil))
			if res.Code != http.StatusOK || res.Header().Get("Content-Type") != "application/manifest+json" {
				t.Fatalf("%s %s fallback: %d %s", method, scheme, res.Code, res.Body.String())
			}
			if method == http.MethodGet && (!strings.Contains(res.Body.String(), "common.svg") || !strings.Contains(res.Body.String(), "Configured")) {
				t.Fatalf("fallback lost common icons or configured title: %s", res.Body.String())
			}
			if method == http.MethodHead && res.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		}
	}
}
