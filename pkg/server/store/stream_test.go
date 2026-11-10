package store

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type interruptedObjectStore struct{ store.Provider }

func (interruptedObjectStore) GetKeystore(context.Context, string) ([]byte, string, error) {
	return []byte(protectedTestKey("")), "key", nil
}

func (interruptedObjectStore) GetObject(context.Context, string, store.ObjectKind, string) (io.ReadCloser, string, error) {
	// Send enough ciphertext to flush HTTP headers before the upstream fails.
	reader := io.MultiReader(strings.NewReader(strings.Repeat("x", 64<<10)), interruptedReader{})
	return io.NopCloser(reader), "object-etag", nil
}

type interruptedReader struct{}

func (interruptedReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestObjectDownloadsRejectInterruptedStreams(t *testing.T) {
	mux := http.NewServeMux()
	New(interruptedObjectStore{}, nil).Attach(mux, "")
	server := httptest.NewServer(mux)
	defer server.Close()

	for _, path := range []string{"/v1/files/file-1234", "/v1/blobs/blob-1234"} {
		t.Run(path, func(t *testing.T) {
			req, err := http.NewRequest("GET", server.URL+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("X-Forwarded-User", "alice")
			req.Header.Set("X-Backup-Generation", "test-generation")
			res, err := server.Client().Do(req)
			if err != nil {
				return // A reset before headers reach the client also rejects the download.
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				t.Fatalf("download did not start: HTTP %d", res.StatusCode)
			}
			if _, err := io.ReadAll(res.Body); err == nil {
				t.Fatal("interrupted upstream returned a complete HTTP response")
			}
		})
	}
}
