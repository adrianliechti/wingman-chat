package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type upstreamError struct {
	status int
	wait   time.Duration
}

func (e upstreamError) Error() string             { return fmt.Sprintf("upstream %d", e.status) }
func (e upstreamError) HTTPStatus() int           { return e.status }
func (e upstreamError) RetryAfter() time.Duration { return e.wait }

func TestStoreErrorMapping(t *testing.T) {
	for _, test := range []struct {
		err        error
		status     int
		retryAfter string
	}{
		{store.ErrInvalidID, 400, ""},
		{store.ErrNotFound, 404, ""},
		{store.ErrFrameTooLarge, 413, ""},
		{&http.MaxBytesError{Limit: 1}, 413, ""},
		{store.ErrSeqConflict, 409, ""},
		{store.ErrBackupConflict, 409, ""},
		{store.ErrObjectConflict, 412, ""},
		{store.ErrKeystoreConflict, 412, ""},
		{fmt.Errorf("wrapped: %w", upstreamError{status: 401}), 401, ""},
		{upstreamError{status: 403}, 403, ""},
		{upstreamError{status: 507}, 507, ""},
		{upstreamError{status: 429, wait: 1500 * time.Millisecond}, 429, "2"},
		{upstreamError{status: 429}, 429, ""},
		{upstreamError{status: 400}, 500, ""},
		{upstreamError{status: 404}, 500, ""},
		{errors.New("boom"), 500, ""},
	} {
		t.Run(test.err.Error(), func(t *testing.T) {
			res := httptest.NewRecorder()
			writeStoreError(res, test.err)
			if res.Code != test.status || res.Header().Get("Retry-After") != test.retryAfter {
				t.Fatalf("got %d Retry-After=%q", res.Code, res.Header().Get("Retry-After"))
			}
		})
	}
}

func TestCASFromRequest(t *testing.T) {
	for _, test := range []struct{ ifMatch, ifNone, want string }{
		{"", "", ""},
		{`"abc"`, "", "abc"},
		{"abc", "", "abc"},
		{" \"abc\" ", "", "abc"},
		{"", "*", "*"},
		{`"abc"`, "*", "*"},
	} {
		r := httptest.NewRequest("PUT", "/", nil)
		if test.ifMatch != "" {
			r.Header.Set("If-Match", test.ifMatch)
		}
		if test.ifNone != "" {
			r.Header.Set("If-None-Match", test.ifNone)
		}
		if got := casFromRequest(r); got != test.want {
			t.Fatalf("%+v: got %q", test, got)
		}
	}
}

// drainingStore consumes upload bodies like a real provider spooling to disk.
type drainingStore struct{ store.Provider }

func (drainingStore) GetKeystore(context.Context, string) ([]byte, string, error) {
	return []byte(protectedTestKey("")), "key", nil
}
func (drainingStore) PutObject(_ context.Context, _ string, _ store.ObjectKind, _ string, r io.Reader, _ string) (string, error) {
	_, err := io.Copy(io.Discard, r)
	return "etag", err
}
func (drainingStore) AppendEvents(context.Context, string, string, int64, []string, [][]byte) (store.AppendResult, error) {
	return store.AppendResult{NewSeq: 1}, nil
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestRequestBodyLimits(t *testing.T) {
	mux := http.NewServeMux()
	New(drainingStore{}, nil).Attach(mux, "")
	send := func(method, path string, body io.Reader, headers map[string]string) int {
		req := httptest.NewRequest(method, path, body)
		req.Header.Set("X-Forwarded-User", "alice")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		return res.Code
	}
	for _, path := range []string{"/v1/files/file-1234", "/v1/blobs/blob-1234"} {
		if code := send("PUT", path, io.LimitReader(zeros{}, store.MaxObjectBytes), nil); code != http.StatusNoContent {
			t.Fatalf("%s at limit: %d", path, code)
		}
		if code := send("PUT", path, io.LimitReader(zeros{}, store.MaxObjectBytes+1), nil); code != http.StatusRequestEntityTooLarge {
			t.Fatalf("%s over limit: %d", path, code)
		}
	}
	line := event("event-id", strings.Repeat("A", 1<<20)) + "\n"
	fit := store.MaxAppendBytes / len(line)
	lines := func(n int) io.Reader { return strings.NewReader(strings.Repeat(line, n)) }
	if code := send("POST", "/v1/chats/chat-1234/events", lines(fit+1), map[string]string{"X-Expected-Seq": "0"}); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("append over limit: %d", code)
	}
	if code := send("POST", "/v1/chats/chat-1234/events", lines(fit), map[string]string{"X-Expected-Seq": "0"}); code != http.StatusOK {
		t.Fatalf("append under limit: %d", code)
	}
}

func TestDeleteFileHonorsIfMatch(t *testing.T) {
	srv := protectedTestServer(t)
	fileID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	res := do(t, srv, "alice", "PUT", "/v1/files/"+fileID, "ciphertext", nil)
	wantStatus(t, res, http.StatusNoContent)
	etag := res.Header.Get("ETag")

	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/files/"+fileID, "", map[string]string{"If-Match": `"stale"`}), http.StatusPreconditionFailed)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/files/"+fileID, "", nil), http.StatusOK)
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/files/"+fileID, "", map[string]string{"If-Match": etag}), http.StatusNoContent)
	wantStatus(t, do(t, srv, "alice", "GET", "/v1/files/"+fileID, "", nil), http.StatusNotFound)
	// Already gone: the caller's intent holds, so a conditional delete is idempotent.
	wantStatus(t, do(t, srv, "alice", "DELETE", "/v1/files/"+fileID, "", map[string]string{"If-Match": etag}), http.StatusNoContent)
}
