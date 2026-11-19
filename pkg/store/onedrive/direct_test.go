package onedrive

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
	"github.com/adrianliechti/wingman-chat/pkg/store/onedrive/onedrivetest"
)

func TestDirectUploadPublication(t *testing.T) {
	p, graph := newTestProvider(t)
	replica := New()
	replica.client = p.client
	replica.tempDir = p.tempDir
	key := bytes.Repeat([]byte{1}, 32)
	p.EnableDirectUploads(key)
	replica.EnableDirectUploads(key)
	const id = "workspace-file"
	testData := bytes.Repeat([]byte{0x22}, uploadChunk+12)
	etag, quick := digest(testData), onedrivetest.QuickXor(testData)

	session, err := p.StartUpload(testSession(), store.FileObject, id, int64(len(testData)), "*")
	if err != nil {
		t.Fatal(err)
	}
	complete := func(ticket, sha, checksum string) (string, error) {
		return replica.CompleteUpload(testSession(), store.FileObject, id, ticket, sha, checksum)
	}
	if _, err := complete(session.Ticket, etag, quick); !errors.Is(err, store.ErrUploadIncomplete) {
		t.Fatalf("untransferred session: %v", err)
	}
	if _, err := complete(session.Ticket+".tampered", etag, quick); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("tampered ticket: %v", err)
	}
	transferTestObject(t, graph, session.URL, testData)
	if _, _, err := p.GetObject(testSession(), store.FileObject, id); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("transfer published before completion: %v", err)
	}
	for range 2 {
		if got, err := complete(session.Ticket, etag, quick); err != nil || got != etag {
			t.Fatalf("completion returned %q, %v", got, err)
		}
	}
	reader, got, err := p.GetObject(testSession(), store.FileObject, id)
	if !bytes.Equal(readAll(t, reader, err), testData) || got != etag {
		t.Fatal("completed payload or ETag differs")
	}
	if files, err := os.ReadDir(p.tempDir); err != nil || len(files) != 0 {
		t.Fatalf("direct path created spool files: %v, %v", files, err)
	}
}

func TestDirectUploadConflictsAndReset(t *testing.T) {
	p, _ := newTestProvider(t)
	p.EnableDirectUploads(bytes.Repeat([]byte{1}, 32))
	const id = "workspace-file"
	const size = uploadChunk + 1
	hash, checksum := digest(nil), onedrivetest.QuickXor(nil)
	start := func(ifMatch string) store.UploadSession {
		t.Helper()
		session, err := p.StartUpload(testSession(), store.FileObject, id, size, ifMatch)
		if err != nil {
			t.Fatal(err)
		}
		return session
	}
	beforeWrite := start("*")
	etag, err := p.PutObject(testSession(), store.FileObject, id, strings.NewReader("current"), "*")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, beforeWrite.Ticket, hash, checksum); !errors.Is(err, store.ErrObjectConflict) {
		t.Fatalf("stale file upload: %v", err)
	}
	beforeReset := start(etag)
	if _, err := p.PutKeystore(testSession(), []byte(`{"generation":"new"}`), "*"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, beforeReset.Ticket, hash, checksum); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("upload survived keystore change: %v", err)
	}
	beforeReset = start(etag)
	if err := p.ResetUser(testSession()); err != nil {
		t.Fatal(err)
	}
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, beforeReset.Ticket, hash, checksum); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("upload survived reset: %v", err)
	}
}

func TestDirectUploadTicketIsBoundToDrive(t *testing.T) {
	p, _ := newTestProvider(t)
	p.client = &http.Client{Transport: &onedrivetest.Accounts{}}
	p.EnableDirectUploads(bytes.Repeat([]byte{1}, 32))
	const id = "attachment"
	alice := WithToken(context.Background(), "alice")
	session, err := p.StartUpload(alice, store.BlobObject, id, uploadChunk+1, "")
	if err != nil {
		t.Fatal(err)
	}
	bob := WithToken(context.Background(), "bob")
	if _, err := p.CompleteUpload(bob, store.BlobObject, id, session.Ticket, digest(nil), onedrivetest.QuickXor(nil)); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("ticket accepted by a separate drive: %v", err)
	}
}

func TestDirectUploadRemovesUnpublishableObjects(t *testing.T) {
	p, graph := newTestProvider(t)
	p.EnableDirectUploads(bytes.Repeat([]byte{1}, 32))
	const id = "workspace-file"
	data := bytes.Repeat([]byte{0x33}, uploadChunk+1)
	stored := func() int {
		graph.Mu.Lock()
		defer graph.Mu.Unlock()
		count := 0
		for _, files := range graph.Folders {
			for name := range files {
				if strings.HasPrefix(name, "data-") {
					count++
				}
			}
		}
		return count
	}
	transferred := func() store.UploadSession {
		t.Helper()
		session, err := p.StartUpload(testSession(), store.FileObject, id, int64(len(data)), "*")
		if err != nil {
			t.Fatal(err)
		}
		transferTestObject(t, graph, session.URL, data)
		return session
	}

	corrupt := transferred()
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, corrupt.Ticket, digest(data), onedrivetest.QuickXor(nil)); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("invalid checksum: %v", err)
	}
	if n := stored(); n != 0 {
		t.Fatalf("rejected upload left %d objects", n)
	}

	stale := transferred()
	if _, err := p.PutObject(testSession(), store.FileObject, id, strings.NewReader("current"), "*"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, stale.Ticket, digest(data), onedrivetest.QuickXor(data)); !errors.Is(err, store.ErrObjectConflict) {
		t.Fatalf("stale upload: %v", err)
	}
	if n := stored(); n != 1 {
		t.Fatalf("got %d objects, want only the published file", n)
	}
}

func TestDirectUploadRejectsInvalidRequests(t *testing.T) {
	p, _ := newTestProvider(t)
	key := bytes.Repeat([]byte{1}, 32)
	p.EnableDirectUploads(key)
	const id = "workspace-file"
	const size = uploadChunk + 1
	ctx := testSession()

	if _, err := New().StartUpload(ctx, store.FileObject, id, size, ""); !errors.Is(err, store.ErrDirectUnavailable) {
		t.Fatalf("disabled provider: %v", err)
	}
	if _, err := p.StartUpload(ctx, store.FileObject, id, uploadChunk, ""); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("small object should use the relay: %v", err)
	}
	var tooLarge *http.MaxBytesError
	if _, err := p.StartUpload(ctx, store.FileObject, id, store.MaxObjectBytes+1, ""); !errors.As(err, &tooLarge) {
		t.Fatalf("oversized object: %v", err)
	}
	if _, err := p.StartUpload(ctx, store.FileObject, "bad id", size, ""); !errors.Is(err, store.ErrInvalidID) {
		t.Fatalf("invalid id: %v", err)
	}
	if _, err := p.PutObject(testSession(), store.FileObject, id, strings.NewReader("current"), "*"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.StartUpload(testSession(), store.FileObject, id, size, "stale-etag"); !errors.Is(err, store.ErrObjectConflict) {
		t.Fatalf("stale If-Match accepted at start: %v", err)
	}

	session, err := p.StartUpload(testSession(), store.FileObject, id, size, "")
	if err != nil {
		t.Fatal(err)
	}
	hash, checksum := digest(nil), onedrivetest.QuickXor(nil)
	complete := func(p *Provider, kind store.ObjectKind, id, ticket string) error {
		_, err := p.CompleteUpload(testSession(), kind, id, ticket, hash, checksum)
		return err
	}
	if err := complete(p, store.FileObject, "other-file", session.Ticket); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("ticket reused for another file: %v", err)
	}
	if err := complete(p, store.BlobObject, id, session.Ticket); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("file ticket accepted for a blob: %v", err)
	}
	other := New()
	other.client = p.client
	other.EnableDirectUploads(bytes.Repeat([]byte{2}, 32))
	if err := complete(other, store.FileObject, id, session.Ticket); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("ticket accepted by a replica with another key: %v", err)
	}
	if _, err := p.CompleteUpload(testSession(), store.FileObject, id, session.Ticket, "not-hex", checksum); !errors.Is(err, store.ErrInvalidUpload) {
		t.Fatalf("malformed SHA-256 accepted: %v", err)
	}

	payload, _, _ := strings.Cut(session.Ticket, ".")
	data, _ := base64.RawURLEncoding.DecodeString(payload)
	var ticket uploadTicket
	if err := json.Unmarshal(data, &ticket); err != nil {
		t.Fatal(err)
	}
	ticket.Expires = time.Now().Add(-time.Second).Unix()
	data, _ = json.Marshal(ticket)
	expired := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(p.signUpload(data))
	if err := complete(p, store.FileObject, id, expired); !errors.Is(err, store.ErrBackupConflict) {
		t.Fatalf("expired ticket: %v", err)
	}
}

func transferTestObject(t *testing.T, graph *onedrivetest.Graph, url string, data []byte) {
	t.Helper()
	for start := 0; start < len(data); {
		end := min(start+uploadChunk, len(data))
		req := httptest.NewRequest(http.MethodPut, url, bytes.NewReader(data[start:end]))
		req.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end-1, len(data)))
		res, err := graph.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusAccepted && res.StatusCode != http.StatusCreated {
			t.Fatalf("unexpected fragment status: %d", res.StatusCode)
		}
		start = end
	}
}
