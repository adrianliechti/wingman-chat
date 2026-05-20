package file

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/chatstore"
)

func newTestProvider(t *testing.T) *Provider {
	t.Helper()
	dir := t.TempDir()
	p, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return p
}

func TestKeystoreCASLifecycle(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()

	if _, _, err := p.GetKeystore(ctx, "alice"); !errors.Is(err, chatstore.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	etag, err := p.PutKeystore(ctx, "alice", []byte(`{"v":1}`), "*")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := p.PutKeystore(ctx, "alice", []byte(`{"v":2}`), "*"); !errors.Is(err, chatstore.ErrKeystoreConflict) {
		t.Fatalf("expected conflict on second create, got %v", err)
	}

	if _, err := p.PutKeystore(ctx, "alice", []byte(`{"v":2}`), "wrong"); !errors.Is(err, chatstore.ErrKeystoreConflict) {
		t.Fatalf("expected conflict on wrong etag, got %v", err)
	}

	etag2, err := p.PutKeystore(ctx, "alice", []byte(`{"v":2}`), etag)
	if err != nil {
		t.Fatalf("update with valid etag: %v", err)
	}
	if etag2 == etag {
		t.Fatalf("etag should change on update")
	}

	data, gotEtag, err := p.GetKeystore(ctx, "alice")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(data) != `{"v":2}` {
		t.Fatalf("got %q", data)
	}
	if gotEtag != etag2 {
		t.Fatalf("etag mismatch %q != %q", gotEtag, etag2)
	}

	// previous version was backed up
	backup := filepath.Join(p.userDir("alice"), "keystore.prev.json")
	prev, err := os.ReadFile(backup)
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if string(prev) != `{"v":1}` {
		t.Fatalf("backup is %q", prev)
	}
}

func TestAppendAndReadEvents(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "11111111-1111-1111-1111-111111111111"

	res, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e1", "e2"}, [][]byte{[]byte("FRAME1"), []byte("FRAME2")})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if res.NewSeq != 2 {
		t.Fatalf("want seq=2 got %d", res.NewSeq)
	}

	r, err := p.ReadEvents(ctx, "alice", chat, 0)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	defer r.Close()
	buf, _ := io.ReadAll(r)
	lines := strings.Count(string(buf), "\n")
	if lines != 2 {
		t.Fatalf("expected 2 lines, got %d: %s", lines, buf)
	}
	if !strings.Contains(string(buf), "FRAME1") || !strings.Contains(string(buf), "FRAME2") {
		t.Fatalf("missing frames: %s", buf)
	}

	// fromSeq filtering
	r2, err := p.ReadEvents(ctx, "alice", chat, 1)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	defer r2.Close()
	buf, _ = io.ReadAll(r2)
	if strings.Count(string(buf), "\n") != 1 || !strings.Contains(string(buf), "FRAME2") {
		t.Fatalf("expected just FRAME2: %s", buf)
	}
}

func TestSeqConflict(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "22222222-2222-2222-2222-222222222222"

	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e1"}, [][]byte{[]byte("X")}); err != nil {
		t.Fatalf("append: %v", err)
	}

	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e2"}, [][]byte{[]byte("Y")}); !errors.Is(err, chatstore.ErrSeqConflict) {
		t.Fatalf("expected seq conflict, got %v", err)
	}
}

func TestDedup(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "33333333-3333-3333-3333-333333333333"

	res, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e1"}, [][]byte{[]byte("first")})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if res.NewSeq != 1 {
		t.Fatalf("want 1 got %d", res.NewSeq)
	}

	// repeat e1 — should be deduped, no new line, seq unchanged
	res, err = p.AppendEvents(ctx, "alice", chat, 1, []string{"e1"}, [][]byte{[]byte("first-again")})
	if err != nil {
		t.Fatalf("dedup retry: %v", err)
	}
	if res.NewSeq != 1 {
		t.Fatalf("seq must stay at 1 on dedup, got %d", res.NewSeq)
	}
	if len(res.Deduped) != 1 || res.Deduped[0] != "e1" {
		t.Fatalf("deduped list = %v", res.Deduped)
	}

	r, _ := p.ReadEvents(ctx, "alice", chat, 0)
	defer r.Close()
	buf, _ := io.ReadAll(r)
	if strings.Count(string(buf), "\n") != 1 {
		t.Fatalf("expected exactly one line, got %s", buf)
	}
}

func TestConcurrentAppend(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "44444444-4444-4444-4444-444444444444"

	// seed seq=1
	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"seed"}, [][]byte{[]byte("s")}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	var wg sync.WaitGroup
	var winners int
	var mu sync.Mutex

	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := []string{string(rune('a' + i))}
			_, err := p.AppendEvents(ctx, "alice", chat, 1, id, [][]byte{[]byte("X")})
			if err == nil {
				mu.Lock()
				winners++
				mu.Unlock()
			} else if !errors.Is(err, chatstore.ErrSeqConflict) {
				t.Errorf("unexpected error: %v", err)
			}
		}(i)
	}
	wg.Wait()

	if winners != 1 {
		t.Fatalf("expected exactly one winner under optimistic concurrency, got %d", winners)
	}
}

func TestPartialLineRecovery(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "55555555-5555-5555-5555-555555555555"

	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e1"}, [][]byte{[]byte("ok")}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Simulate a crashed write: append garbage without newline.
	logPath := p.chatLogPath("alice", chat)
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	f.Write([]byte(`{"seq":2,"id":"e2","frame":"X"`)) // intentionally no \n
	f.Close()

	// next append must recover by truncating, then succeed at seq=2
	res, err := p.AppendEvents(ctx, "alice", chat, 1, []string{"e2"}, [][]byte{[]byte("recovered")})
	if err != nil {
		t.Fatalf("append after partial: %v", err)
	}
	if res.NewSeq != 2 {
		t.Fatalf("want 2 got %d", res.NewSeq)
	}

	r, _ := p.ReadEvents(ctx, "alice", chat, 0)
	defer r.Close()
	buf, _ := io.ReadAll(r)
	if strings.Count(string(buf), "\n") != 2 {
		t.Fatalf("expected 2 lines after recovery, got: %s", buf)
	}
}

func TestRejectInvalidChatID(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()

	for _, bad := range []string{"", "../etc/passwd", "with spaces", "x"} {
		if _, err := p.AppendEvents(ctx, "alice", bad, 0, []string{"e"}, [][]byte{[]byte("x")}); !errors.Is(err, chatstore.ErrInvalidID) {
			t.Fatalf("expected ErrInvalidID for %q, got %v", bad, err)
		}
	}
}

func TestListChats(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()

	list, err := p.ListChats(ctx, "alice")
	if err != nil || len(list) != 0 {
		t.Fatalf("empty list expected: %v %v", list, err)
	}

	for _, c := range []string{
		"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
	} {
		if _, err := p.AppendEvents(ctx, "alice", c, 0, []string{"e"}, [][]byte{[]byte("x")}); err != nil {
			t.Fatalf("append: %v", err)
		}
	}

	list, err = p.ListChats(ctx, "alice")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 chats, got %d", len(list))
	}
	for _, m := range list {
		if m.HeadSeq != 1 {
			t.Fatalf("headSeq=%d", m.HeadSeq)
		}
	}
}

func TestBlobRoundTrip(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const blob = "blob-abc-123"

	if err := p.PutBlob(ctx, "alice", blob, strings.NewReader("hello")); err != nil {
		t.Fatalf("put: %v", err)
	}

	r, err := p.GetBlob(ctx, "alice", blob)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer r.Close()
	buf, _ := io.ReadAll(r)
	if string(buf) != "hello" {
		t.Fatalf("got %q", buf)
	}

	if err := p.DeleteBlob(ctx, "alice", blob); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := p.GetBlob(ctx, "alice", blob); !errors.Is(err, chatstore.ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestDeleteChatIsIdempotent(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "66666666-6666-6666-6666-666666666666"

	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"e"}, [][]byte{[]byte("x")}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := p.DeleteChat(ctx, "alice", chat); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := p.DeleteChat(ctx, "alice", chat); err != nil {
		t.Fatalf("delete twice: %v", err)
	}
}

func TestBlobExists(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()

	exists, err := p.BlobExists(ctx, "alice", "blob-abc-123")
	if err != nil {
		t.Fatalf("exists empty: %v", err)
	}
	if exists {
		t.Fatalf("expected false for missing blob")
	}

	if err := p.PutBlob(ctx, "alice", "blob-abc-123", strings.NewReader("data")); err != nil {
		t.Fatalf("put: %v", err)
	}

	exists, err = p.BlobExists(ctx, "alice", "blob-abc-123")
	if err != nil || !exists {
		t.Fatalf("expected true, got %v %v", exists, err)
	}

	if _, err := p.BlobExists(ctx, "alice", "../etc/passwd"); !errors.Is(err, chatstore.ErrInvalidID) {
		t.Fatalf("expected ErrInvalidID, got %v", err)
	}
}

func TestCompactChat(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "88888888-8888-8888-8888-888888888888"

	// seed seq 1..5
	for i := 1; i <= 5; i++ {
		if _, err := p.AppendEvents(ctx, "alice", chat, int64(i-1), []string{fmt.Sprintf("e%d", i)}, [][]byte{[]byte(fmt.Sprintf("frame%d", i))}); err != nil {
			t.Fatalf("seed seq %d: %v", i, err)
		}
	}

	// compact, drop everything < seq 4
	if err := p.CompactChat(ctx, "alice", chat, 4); err != nil {
		t.Fatalf("compact: %v", err)
	}

	r, err := p.ReadEvents(ctx, "alice", chat, 0)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	defer r.Close()
	body, _ := io.ReadAll(r)
	lines := strings.Count(string(body), "\n")
	if lines != 2 {
		t.Fatalf("expected 2 surviving lines, got %d: %s", lines, body)
	}
	if !strings.Contains(string(body), `"seq":4`) || !strings.Contains(string(body), `"seq":5`) {
		t.Fatalf("expected seqs 4 and 5 to survive: %s", body)
	}

	// head seq still 5 — subsequent append continues at 6
	res, err := p.AppendEvents(ctx, "alice", chat, 5, []string{"e6"}, [][]byte{[]byte("frame6")})
	if err != nil {
		t.Fatalf("append after compact: %v", err)
	}
	if res.NewSeq != 6 {
		t.Fatalf("expected newSeq=6 after compact, got %d", res.NewSeq)
	}

	// idempotent: compact with same beforeSeq is a no-op
	if err := p.CompactChat(ctx, "alice", chat, 4); err != nil {
		t.Fatalf("compact twice: %v", err)
	}
}

func TestFrameSizeLimit(t *testing.T) {
	p := newTestProvider(t)
	ctx := context.Background()
	const chat = "77777777-7777-7777-7777-777777777777"

	big := make([]byte, chatstore.MaxFrameBytes+1)
	if _, err := p.AppendEvents(ctx, "alice", chat, 0, []string{"big"}, [][]byte{big}); !errors.Is(err, chatstore.ErrFrameTooLarge) {
		t.Fatalf("expected ErrFrameTooLarge, got %v", err)
	}
}
