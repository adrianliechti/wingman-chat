package store

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"iter"
	"time"
)

// ChatMeta describes a single chat as seen by the server. The contents
// (title, messages, etc.) are encrypted client-side and opaque here.
type ChatMeta struct {
	ID      string    `json:"id"`
	HeadSeq int64     `json:"headSeq"`
	Updated time.Time `json:"updated"`
	Deleted bool      `json:"deleted,omitempty"`
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

// AppendResult is returned by AppendEventStream.
//
// NewSeq is the seq assigned to the last accepted frame; if all input
// frames were deduplicated, NewSeq equals the head before the call.
// Deduped lists the event_ids that were already present and therefore
// skipped — clients can treat these as successful idempotent retries.
type AppendResult struct {
	NewSeq  int64    `json:"newSeq"`
	Deduped []string `json:"deduped,omitempty"`
}

// EventFrame is one opaque encrypted frame and its deduplication ID.
type EventFrame struct {
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

// ChatAppend is one chat's encrypted events and expected head in a batch.
type ChatAppend struct {
	ID          string       `json:"id"`
	ExpectedSeq int64        `json:"expectedSeq"`
	Events      []EventFrame `json:"events"`
}

// ChatBatchAppender publishes compatible appends with one index commit.
// Results follow input order; nil marks a chat whose head has changed.
type ChatBatchAppender interface {
	AppendChatBatch(ctx context.Context, writes []ChatAppend) ([]*AppendResult, error)
}

// ObjectKind separates workspace files from attachment blobs, even when IDs match.
// Providers reject kinds other than FileObject and BlobObject with ErrInvalidID.
type ObjectKind uint8

const (
	FileObject ObjectKind = iota + 1
	BlobObject
)

// DirectUploader reserves a OneDrive object and publishes it after the browser
// has sent the ciphertext to storage.
type DirectUploader interface {
	DirectUploadsEnabled() bool
	StartUpload(ctx context.Context, kind ObjectKind, id string, size int64, ifMatch string) (UploadSession, error)
	CompleteUpload(ctx context.Context, kind ObjectKind, id, ticket, sha256, quickXor string) (string, error)
}

type UploadSession struct {
	URL       string    `json:"uploadUrl"`
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// FileWrite is one encrypted workspace file in a PutFiles batch.
type FileWrite struct {
	ID      string
	Body    io.Reader
	IfMatch string
}

// FileDelete is one workspace file in a DeleteFiles batch.
type FileDelete struct {
	ID      string
	IfMatch string
}

// Provider is a pluggable backend for the per-user chat store.
// The account is resolved from the request context (e.g. a delegated token),
// so the caller cannot address another user's data.
//
// The server never decrypts key, frame, or blob contents. Providers must
// fence stale writes after reset or keystore changes and
// preserve an existing keystore backup envelope when root-key protection changes.
type Provider interface {
	// BackupSize returns approximate stored bytes, including encrypted data and metadata.
	BackupSize(ctx context.Context) (int64, error)

	// ResetUser removes backup data and keys, fencing concurrent stale writes.
	// It returns ErrKeystoreConflict when the backup no longer matches cond.
	ResetUser(ctx context.Context, cond ResetCondition) error

	// GetKeystore returns the raw keystore bytes and an opaque etag.
	// Returns ErrNotFound if no keystore exists yet for the user.
	GetKeystore(ctx context.Context) (data []byte, etag string, err error)

	// PutKeystore replaces the keystore atomically.
	//   ifMatch == "*"    → create only (fail with ErrKeystoreConflict if exists)
	//   ifMatch == "<x>"  → CAS, must match current etag
	PutKeystore(ctx context.Context, data []byte, ifMatch string) (etag string, err error)

	// ListChats returns metadata for every chat owned by the user.
	ListChats(ctx context.Context) ([]ChatMeta, error)

	// AppendEventStream appends frames to a chat's append-only log. It must
	// consume the stream without error before publishing any events.
	// expectedSeq must match the current head; otherwise ErrSeqConflict.
	// Previously-seen event IDs are silently skipped and returned in Deduped.
	AppendEventStream(ctx context.Context, chatID string, expectedSeq int64, events iter.Seq2[EventFrame, error]) (AppendResult, error)

	// ReadEvents streams JSONL frames whose seq > fromSeq. The reader yields
	// the JSONL envelope format:
	//   {"seq":<int>,"id":"<uuid>","frame":"<base64>"}\n
	ReadEvents(ctx context.Context, chatID string, fromSeq int64) (io.ReadCloser, error)

	// DeleteChat removes event history only if expectedSeq matches the current
	// head. Retain a tombstone with an advanced head so recreation cannot reuse
	// sequence numbers. Repeating a delete of an existing tombstone succeeds.
	DeleteChat(ctx context.Context, chatID string, expectedSeq int64) error

	// CompactChat drops every log entry whose seq < beforeSeq. The head
	// seq is preserved (we shrink from the front, not the back). It is
	// the caller's responsibility to ensure the surviving frame at
	// beforeSeq is self-contained (init-led) so fresh readers can
	// replay correctly.
	CompactChat(ctx context.Context, chatID string, beforeSeq int64) error

	// GetObject streams encrypted content and returns its current ETag.
	// ErrBackupConflict means a concurrent writer replaced the object; retry.
	GetObject(ctx context.Context, kind ObjectKind, id string) (io.ReadCloser, string, error)

	// PutObject atomically replaces encrypted content. ifMatch is empty for an
	// unconditional write, "*" for create-only, or an ETag for compare-and-swap.
	// A failed precondition returns ErrObjectConflict.
	PutObject(ctx context.Context, kind ObjectKind, id string, r io.Reader, ifMatch string) (string, error)

	// PutFiles atomically replaces several workspace files with a single index
	// commit. Bodies are read sequentially in slice order. Each IfMatch follows
	// PutObject; if any precondition fails nothing is published and
	// ErrObjectConflict is returned. ETags are returned in input order.
	PutFiles(ctx context.Context, writes []FileWrite) ([]string, error)

	// DeleteFiles removes several workspace files with a single index commit.
	// Each IfMatch follows DeleteObject. A file whose precondition fails is kept
	// and reported false; deleted and missing files report true, in input order.
	DeleteFiles(ctx context.Context, deletes []FileDelete) ([]bool, error)

	// DeleteObject removes encrypted content. Missing objects return nil.
	// ifMatch is empty or "*" for an unconditional delete, or an ETag that must
	// match the current object; a mismatch returns ErrObjectConflict.
	DeleteObject(ctx context.Context, kind ObjectKind, id string, ifMatch string) error

	// BlobExists checks attachment availability without downloading its content.
	BlobExists(ctx context.Context, blobID string) (bool, error)

	// ListFiles returns metadata for every synced workspace file.
	ListFiles(ctx context.Context) ([]FileMeta, error)
}

// ResetCondition names the backup the user confirmed deleting, so a delayed
// or retried reset cannot remove a backup configured after the confirmation.
type ResetCondition struct {
	// Keystore is the confirmed keystore ETag; empty means no keystore existed.
	Keystore string
	// Unreadable confirms deleting an index that cannot be decoded.
	Unreadable bool
	// Unconditional skips the check. Not reachable over HTTP.
	Unconditional bool
}

var (
	ErrBackupConflict    = errors.New("store: backup changed; retry with fresh state")
	ErrInvalidBackup     = errors.New("store: backup index is unreadable")
	ErrNotFound          = errors.New("store: not found")
	ErrSeqConflict       = errors.New("store: seq conflict")
	ErrKeystoreConflict  = errors.New("store: keystore etag conflict")
	ErrObjectConflict    = errors.New("store: object etag conflict")
	ErrInvalidID         = errors.New("store: invalid id")
	ErrInvalidRequest    = errors.New("store: invalid request")
	ErrFrameTooLarge     = errors.New("store: frame too large")
	ErrDirectUnavailable = errors.New("store: direct upload unavailable")
	ErrInvalidUpload     = errors.New("store: invalid upload metadata")
	ErrUploadIncomplete  = errors.New("store: direct upload incomplete")
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

// Chat batches bound the total buffered ciphertext and the number of logs.
const (
	MaxChatBatchBytes = 16 << 20
	MaxChatBatchChats = 8
)

// MaxBatchBytes caps one PutFiles request body; MaxBatchFiles caps the
// entries of a PutFiles or DeleteFiles request.
const (
	MaxBatchBytes = 64 << 20 // 64 MiB
	MaxBatchFiles = 100
)

// PreservesIdentity prevents a keystore update from orphaning existing
// ciphertext, which is bound to the keystore's account ID, or from un-fencing
// devices that were stopped by a backup generation change.
func PreservesIdentity(current, next []byte) bool {
	if len(current) == 0 {
		return true
	}
	type identity struct {
		AccountID  string `json:"accountId"`
		Generation string `json:"generation"`
	}
	var previous, replacement identity
	return json.Unmarshal(current, &previous) == nil && json.Unmarshal(next, &replacement) == nil && previous == replacement
}
