package public

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/config"
)

func TestPrecompressedAssets(t *testing.T) {
	wasm := []byte("\x00asm\x01\x00\x00\x00")
	// The same minimal WASM module, Brotli-encoded using node:zlib.
	brotli := []byte{139, 3, 128, 0, 97, 115, 109, 1, 0, 0, 0, 3}
	var zipped bytes.Buffer
	compressor := gzip.NewWriter(&zipped)
	if _, err := compressor.Write(wasm); err != nil {
		t.Fatal(err)
	}
	if err := compressor.Close(); err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	dist := fstest.MapFS{
		"assets/runtime-abc.wasm":    {Data: wasm, ModTime: modified},
		"assets/runtime-abc.wasm.br": {Data: brotli, ModTime: modified},
		"assets/runtime-abc.wasm.gz": {Data: zipped.Bytes(), ModTime: modified},
	}
	mux := http.NewServeMux()
	New(&config.Config{}, dist).Attach(mux)

	tests := []struct {
		name     string
		accept   []string
		encoding string
		status   int
	}{
		{name: "no encoding header", status: http.StatusOK},
		{name: "empty encoding header", accept: []string{""}, status: http.StatusOK},
		{name: "prefer Brotli on ties", accept: []string{"gzip, deflate, br"}, encoding: "br", status: http.StatusOK},
		{name: "gzip only", accept: []string{"gzip"}, encoding: "gzip", status: http.StatusOK},
		{name: "weighted gzip", accept: []string{"br;q=0.5, gzip;q=1"}, encoding: "gzip", status: http.StatusOK},
		{name: "exclude Brotli", accept: []string{"br;q=0, gzip"}, encoding: "gzip", status: http.StatusOK},
		{name: "wildcard", accept: []string{"*"}, encoding: "br", status: http.StatusOK},
		{name: "wildcard with exclusion", accept: []string{"*;q=0.5, br;q=0"}, encoding: "gzip", status: http.StatusOK},
		{name: "case insensitive", accept: []string{"BR;Q=1"}, encoding: "br", status: http.StatusOK},
		{name: "multiple header fields", accept: []string{"gzip;q=0.5", "br"}, encoding: "br", status: http.StatusOK},
		{name: "identity preference", accept: []string{"identity;q=1, br;q=0.5"}, status: http.StatusOK},
		{name: "unsupported coding", accept: []string{"deflate"}, status: http.StatusOK},
		{name: "all compression disabled", accept: []string{"br;q=0, gzip;q=0"}, status: http.StatusOK},
		{name: "invalid weight", accept: []string{"br;q=NaN, gzip;q=2"}, status: http.StatusOK},
		{name: "everything excluded", accept: []string{"*;q=0"}, status: http.StatusNotAcceptable},
		{name: "no usable encoding", accept: []string{"deflate, identity;q=0"}, status: http.StatusNotAcceptable},
		{name: "identity overrides wildcard", accept: []string{"*;q=0, identity"}, status: http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
			req.Header["Accept-Encoding"] = tt.accept
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != tt.status {
				t.Fatalf("status = %d, want %d", res.Code, tt.status)
			}
			if got := res.Header().Get("Vary"); got != "Accept-Encoding" {
				t.Errorf("Vary = %q", got)
			}
			if got := res.Header().Get("Content-Encoding"); got != tt.encoding {
				t.Fatalf("Content-Encoding = %q, want %q", got, tt.encoding)
			}
			if tt.status != http.StatusOK {
				if got := res.Header().Get("Cache-Control"); got != "" {
					t.Errorf("error response must not be cached as an asset: %q", got)
				}
				return
			}
			if got := res.Header().Get("Content-Type"); got != "application/wasm" {
				t.Errorf("Content-Type = %q", got)
			}
			if got := res.Header().Get("Cache-Control"); got != cacheImmutable {
				t.Errorf("Cache-Control = %q", got)
			}
			want := wasm
			if tt.encoding == "br" {
				want = brotli
			} else if tt.encoding == "gzip" {
				want = zipped.Bytes()
			}
			if !bytes.Equal(res.Body.Bytes(), want) {
				t.Errorf("body = %v, want %v", res.Body.Bytes(), want)
			}
			if got := res.Header().Get("Content-Length"); got != strconv.Itoa(len(want)) {
				t.Errorf("Content-Length = %q, want %d", got, len(want))
			}
		})
	}

	t.Run("HEAD returns encoded metadata without a body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodHead, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "br")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Body.Len() != 0 || res.Header().Get("Content-Encoding") != "br" || res.Header().Get("Content-Length") != strconv.Itoa(len(brotli)) {
			t.Fatalf("unexpected HEAD response: %d %v %q", res.Code, res.Header(), res.Body.String())
		}
	})
	t.Run("conditional request revalidates the encoded file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "br")
		req.Header.Set("If-Modified-Since", modified.Format(http.TimeFormat))
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusNotModified || res.Body.Len() != 0 || res.Header().Get("Vary") != "Accept-Encoding" {
			t.Fatalf("unexpected revalidation response: %d %v %q", res.Code, res.Header(), res.Body.String())
		}
	})
	t.Run("ranges use original bytes", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "br, gzip")
		req.Header.Set("Range", "bytes=0-3")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusPartialContent || res.Header().Get("Content-Encoding") != "" || !bytes.Equal(res.Body.Bytes(), wasm[:4]) || res.Header().Get("Content-Range") != "bytes 0-3/8" {
			t.Fatalf("unexpected range response: %d %v %v", res.Code, res.Header(), res.Body.Bytes())
		}
	})
	t.Run("encoded-only ranges receive a decodable complete file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "gzip, identity;q=0")
		req.Header.Set("Range", "bytes=0-3,5-6")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("unexpected response: %d %v", res.Code, res.Header())
		}
		reader, err := gzip.NewReader(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		defer reader.Close()
		decoded, err := io.ReadAll(reader)
		if err != nil || !bytes.Equal(decoded, wasm) {
			t.Fatalf("decoded = %v, err = %v", decoded, err)
		}
	})
	t.Run("stale Brotli falls back to gzip", func(t *testing.T) {
		dist["assets/runtime-abc.wasm.br"].ModTime = modified.Add(-time.Second)
		req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "br, gzip")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("unexpected response: %d %v", res.Code, res.Header())
		}
	})
	t.Run("missing variants fall back to original", func(t *testing.T) {
		delete(dist, "assets/runtime-abc.wasm.br")
		delete(dist, "assets/runtime-abc.wasm.gz")
		req := httptest.NewRequest(http.MethodGet, "/assets/runtime-abc.wasm", nil)
		req.Header.Set("Accept-Encoding", "br, gzip")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("Content-Encoding") != "" || !bytes.Equal(res.Body.Bytes(), wasm) {
			t.Fatalf("unexpected response: %d %v %v", res.Code, res.Header(), res.Body.Bytes())
		}
	})
}

func TestCompressedSPAFallback(t *testing.T) {
	const shell = "<!doctype html><title>App</title>"
	var zipped bytes.Buffer
	compressor := gzip.NewWriter(&zipped)
	compressor.Write([]byte(shell))
	compressor.Close()
	dist := fstest.MapFS{
		"index.html":    {Data: []byte(shell)},
		"index.html.gz": {Data: zipped.Bytes()},
	}
	mux := http.NewServeMux()
	New(&config.Config{}, dist).Attach(mux)
	for _, target := range []string{"/", "/chats/example.com"} {
		t.Run(target, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, target, nil)
			req.Header.Set("Accept", "text/html")
			req.Header.Set("Accept-Encoding", "br, gzip")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusOK || res.Header().Get("Content-Encoding") != "gzip" || !bytes.Equal(res.Body.Bytes(), zipped.Bytes()) {
				t.Fatalf("unexpected SPA response: %d %v %v", res.Code, res.Header(), res.Body.Bytes())
			}
			if !strings.HasPrefix(res.Header().Get("Content-Type"), "text/html") || res.Header().Get("Cache-Control") != cacheRevalidate {
				t.Fatalf("unexpected SPA headers: %v", res.Header())
			}
		})
	}
	for _, target := range []string{"/missing.wasm", "/config.json", "/index.html"} {
		t.Run(target, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, target, nil)
			req.Header.Set("Accept-Encoding", "br, gzip")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			status := map[string]int{"/missing.wasm": http.StatusNotFound, "/config.json": http.StatusOK, "/index.html": http.StatusMovedPermanently}[target]
			if res.Code != status || res.Header().Get("Content-Encoding") != "" {
				t.Fatalf("unexpected response: %d %v", res.Code, res.Header())
			}
		})
	}
}
