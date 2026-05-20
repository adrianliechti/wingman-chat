package chatstore

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

// Provider is a pluggable backend for the per-user chat store.
//
// Implementations must treat keystore, frame, and blob bytes as opaque:
// the server side never decrypts or inspects payloads.
type Provider interface {
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
	// the same line format the log uses on disk:
	//   {"seq":<int>,"id":"<uuid>","frame":"<base64>"}\n
	ReadEvents(ctx context.Context, userID, chatID string, fromSeq int64) (io.ReadCloser, error)

	// DeleteChat removes the entire log and dedup sidecar for the chat.
	DeleteChat(ctx context.Context, userID, chatID string) error

	// CompactChat drops every log entry whose seq < beforeSeq. The head
	// seq is preserved (we shrink from the front, not the back). It is
	// the caller's responsibility to ensure the surviving frame at
	// beforeSeq is self-contained (init-led) so fresh readers can
	// replay correctly.
	CompactChat(ctx context.Context, userID, chatID string, beforeSeq int64) error

	// GetBlob streams the raw (still-encrypted) bytes for a blob.
	GetBlob(ctx context.Context, userID, blobID string) (io.ReadCloser, error)

	// BlobExists reports whether a blob is present without reading its
	// body — used as a cheap upload existence check.
	BlobExists(ctx context.Context, userID, blobID string) (bool, error)

	// PutBlob writes a blob atomically.
	PutBlob(ctx context.Context, userID, blobID string, r io.Reader) error

	// DeleteBlob removes a blob. Missing blobs return nil (idempotent).
	DeleteBlob(ctx context.Context, userID, blobID string) error
}

var (
	ErrNotFound         = errors.New("chatstore: not found")
	ErrSeqConflict      = errors.New("chatstore: seq conflict")
	ErrKeystoreConflict = errors.New("chatstore: keystore etag conflict")
	ErrInvalidID        = errors.New("chatstore: invalid id")
	ErrFrameTooLarge    = errors.New("chatstore: frame too large")
)

// MaxFrameBytes caps a single base64-encoded frame envelope. Blobs go
// through PutBlob, not event frames.
const MaxFrameBytes = 1 << 20 // 1 MiB
