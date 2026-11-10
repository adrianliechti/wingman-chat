package store

import (
	"context"
	"errors"
	"io"
	"time"
)

// ChatMeta describes a single chat as seen by the server. The contents
// (title, messages, etc.) are encrypted client-side and opaque here.
type ChatMeta struct {
	ID      string    `json:"id"`
	HeadSeq int64     `json:"headSeq"`
	Updated time.Time `json:"updated"`
}

// FileMeta describes one entry of a user's synced file tree. The file id
// is derived client-side (hash of the OPFS path); the real path travels
// only inside the encrypted body, though the server can guess common paths from their hashes.
type FileMeta struct {
	ID      string    `json:"id"`
	ETag    string    `json:"etag"`
	Updated time.Time `json:"updated"`
	Size    int64     `json:"size"`
}

// AppendResult is returned by AppendEvents.
//
// NewSeq is the seq assigned to the last accepted frame; if all input
// frames were deduplicated, NewSeq equals the head before the call.
// Deduped lists the event_ids that were already present and therefore
// skipped — clients can treat these as successful idempotent retries.
type AppendResult struct {
	NewSeq  int64    `json:"newSeq"`
	Deduped []string `json:"deduped,omitempty"`
}

// ObjectKind separates workspace files from attachment blobs, even when IDs match.
// Providers reject kinds other than FileObject and BlobObject with ErrInvalidID.
type ObjectKind uint8

const (
	FileObject ObjectKind = iota + 1
	BlobObject
)

// Provider is a pluggable backend for the per-user chat store.
//
// The server never decrypts key, frame, or blob contents. Providers must
// fence stale writes after reset or keystore changes and
// preserve an existing keystore backup envelope when root-key protection changes.
type Provider interface {
	// BackupSize returns approximate stored bytes, including encrypted data and metadata.
	BackupSize(ctx context.Context, userID string) (int64, error)

	// ResetUser removes backup data and keys, fencing concurrent stale writes.
	ResetUser(ctx context.Context, userID, resetID string) error

	// GetKeystore returns the raw keystore bytes and an opaque etag.
	// Returns ErrNotFound if no keystore exists yet for the user.
	GetKeystore(ctx context.Context, userID string) (data []byte, etag string, err error)

	// PutKeystore replaces the keystore atomically.
	//   ifMatch == ""     → unconditional replace
	//   ifMatch == "*"    → create only (fail with ErrKeystoreConflict if exists)
	//   ifMatch == "<x>"  → CAS, must match current etag
	PutKeystore(ctx context.Context, userID string, data []byte, ifMatch string) (etag string, err error)

	// ListChats returns metadata for every chat owned by the user.
	ListChats(ctx context.Context, userID string) ([]ChatMeta, error)

	// AppendEvents appends one or more frames to a chat's append-only log.
	// expectedSeq must match the current head; otherwise ErrSeqConflict.
	// Each frame is paired with an eventID; previously-seen eventIDs are
	// silently skipped and returned in Deduped.
	AppendEvents(ctx context.Context, userID, chatID string, expectedSeq int64, eventIDs []string, frames [][]byte) (AppendResult, error)

	// ReadEvents streams JSONL frames whose seq > fromSeq. The reader yields
	// the JSONL envelope format:
	//   {"seq":<int>,"id":"<uuid>","frame":"<base64>"}\n
	ReadEvents(ctx context.Context, userID, chatID string, fromSeq int64) (io.ReadCloser, error)

	// DeleteChat removes the chat and its event history.
	DeleteChat(ctx context.Context, userID, chatID string) error

	// CompactChat drops every log entry whose seq < beforeSeq. The head
	// seq is preserved (we shrink from the front, not the back). It is
	// the caller's responsibility to ensure the surviving frame at
	// beforeSeq is self-contained (init-led) so fresh readers can
	// replay correctly.
	CompactChat(ctx context.Context, userID, chatID string, beforeSeq int64) error

	// GetObject streams encrypted content and returns its current ETag.
	// ErrBackupConflict means a concurrent writer replaced the object; retry.
	GetObject(ctx context.Context, userID string, kind ObjectKind, id string) (io.ReadCloser, string, error)

	// PutObject atomically replaces encrypted content. ifMatch is empty for an
	// unconditional write, "*" for create-only, or an ETag for compare-and-swap.
	// A failed precondition returns ErrObjectConflict.
	PutObject(ctx context.Context, userID string, kind ObjectKind, id string, r io.Reader, ifMatch string) (string, error)

	// DeleteObject removes encrypted content. Missing objects return nil.
	// ifMatch is empty or "*" for an unconditional delete, or an ETag that must
	// match the current object; a mismatch returns ErrObjectConflict.
	DeleteObject(ctx context.Context, userID string, kind ObjectKind, id string, ifMatch string) error

	// BlobExists checks attachment availability without downloading its content.
	BlobExists(ctx context.Context, userID, blobID string) (bool, error)

	// ListFiles returns metadata for every synced workspace file.
	ListFiles(ctx context.Context, userID string) ([]FileMeta, error)
}

var (
	ErrBackupConflict   = errors.New("store: backup changed; retry with fresh state")
	ErrNotFound         = errors.New("store: not found")
	ErrSeqConflict      = errors.New("store: seq conflict")
	ErrKeystoreConflict = errors.New("store: keystore etag conflict")
	ErrObjectConflict   = errors.New("store: object etag conflict")
	ErrInvalidID        = errors.New("store: invalid id")
	ErrFrameTooLarge    = errors.New("store: frame too large")
)

// MaxFrameBytes caps a single base64-encoded frame envelope. Blobs go
// through PutObject, not event frames. Clients chunk deltas into ~4 MiB
// frames, but a chunk cannot split a single log entry — the headroom is
// for one message carrying megabytes of text (pasted logs, tool results).
const MaxFrameBytes = 16 << 20 // 16 MiB

// MaxObjectBytes caps one encrypted file or blob upload: the client's 256 MiB
// plaintext limit plus headroom for per-chunk encryption overhead.
const MaxObjectBytes = 256<<20 + 1<<20

// MaxAppendBytes caps one append request body (all JSONL event lines).
const MaxAppendBytes = 64 << 20 // 64 MiB
