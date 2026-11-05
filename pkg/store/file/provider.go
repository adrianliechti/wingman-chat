package file

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

var _ store.Provider = (*Provider)(nil)

// Provider is a file-backed implementation of store.Provider.
//
// Layout:
//
//	{root}/{sha256(userID)[:32]}/
//	    keystore.json
//	    keystore.prev.json    (obsolete sidecar removed on keystore update)
//	    chats/{chatID}.jsonl
//	    chats/{chatID}.head   (committed seq, log size, recent event IDs)
//	    chats/{chatID}.ids    (legacy dedup sidecar, migrated on write)
//	    blobs/{blobID}
type Provider struct {
	root string
}

// uuidLike permits UUIDs as well as similarly-shaped opaque IDs the
// client may generate — anything outside the alphabet/length is refused.
var uuidLike = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

const (
	dedupCapacity   = 1000
	dedupRecordSize = 16 // truncated SHA-256 hash of eventID
)

func New(root string) (*Provider, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Join(abs, ".locks"), 0o700); err != nil {
		return nil, err
	}
	return &Provider{root: abs}, nil
}

func userHash(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(sum[:16]) // 32 hex chars
}

func validateID(id string) error {
	if !uuidLike.MatchString(id) {
		return store.ErrInvalidID
	}
	return nil
}

func (p *Provider) userDir(userID string) string {
	return filepath.Join(p.root, userHash(userID))
}

func (p *Provider) chatsDir(userID string) string {
	return filepath.Join(p.userDir(userID), "chats")
}

func (p *Provider) blobsDir(userID string) string {
	return filepath.Join(p.userDir(userID), "blobs")
}

func ensureDir(path string) error {
	return os.MkdirAll(path, 0o700)
}

func writeAtomic(path string, data []byte) error {
	if err := ensureDir(filepath.Dir(path)); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}

	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}

	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return nil
}

func etagOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// keystore ----------------------------------------------------------------

func (p *Provider) keystorePath(userID string) string {
	return filepath.Join(p.userDir(userID), "keystore.json")
}

func (p *Provider) keystoreBackupPath(userID string) string {
	return filepath.Join(p.userDir(userID), "keystore.prev.json")
}

func (p *Provider) GetKeystore(_ context.Context, userID string) ([]byte, string, error) {
	data, err := os.ReadFile(p.keystorePath(userID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", store.ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return data, etagOf(data), nil
}

func (p *Provider) PutKeystore(ctx context.Context, userID string, data []byte, ifMatch string) (string, error) {
	unlock, err := p.lock(ctx, "keystore:"+userID)
	if err != nil {
		return "", err
	}
	defer unlock()

	path := p.keystorePath(userID)

	current, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	switch ifMatch {
	case "":
		// unconditional
	case "*":
		if exists {
			return "", store.ErrKeystoreConflict
		}
	default:
		if !exists || etagOf(current) != ifMatch {
			return "", store.ErrKeystoreConflict
		}
	}

	// Older clients can rewrap the root key but do not know the backup key
	// envelope. Never let them discard or replace it and orphan v3 backups.
	var previous, next map[string]json.RawMessage
	if json.Unmarshal(current, &previous) == nil && len(previous["backup"]) > 0 && string(previous["backup"]) != "null" {
		if json.Unmarshal(data, &next) != nil {
			return "", store.ErrKeystoreConflict
		}
		var oldKey, newKey struct {
			PublicKey           string `json:"publicKey"`
			EncryptedPrivateKey string `json:"encryptedPrivateKey"`
		}
		if json.Unmarshal(previous["backup"], &oldKey) != nil || json.Unmarshal(next["backup"], &newKey) != nil || oldKey != newKey {
			return "", store.ErrKeystoreConflict
		}
	}

	// A previous keystore can contain a plaintext key or an obsolete unlock
	// method. Keeping it would bypass the newly selected protection. Remove
	// legacy sidecars before committing the replacement; payloads stay opaque.
	if err := os.Remove(p.keystoreBackupPath(userID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	if err := writeAtomic(path, data); err != nil {
		return "", err
	}

	return etagOf(data), nil
}

// chat log ----------------------------------------------------------------

func (p *Provider) chatLogPath(userID, chatID string) string {
	return filepath.Join(p.chatsDir(userID), chatID+".jsonl")
}

func (p *Provider) chatHeadPath(userID, chatID string) string {
	return filepath.Join(p.chatsDir(userID), chatID+".head")
}

func (p *Provider) chatDedupPath(userID, chatID string) string {
	return filepath.Join(p.chatsDir(userID), chatID+".ids")
}

func (p *Provider) ListChats(_ context.Context, userID string) ([]store.ChatMeta, error) {
	dir := p.chatsDir(userID)

	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []store.ChatMeta{}, nil
	}
	if err != nil {
		return nil, err
	}

	out := make([]store.ChatMeta, 0, len(entries))

	for _, e := range entries {
		if e.IsDir() {
			continue
		}

		name := e.Name()

		if filepath.Ext(name) != ".jsonl" {
			continue
		}

		chatID := name[:len(name)-len(".jsonl")]

		if validateID(chatID) != nil {
			continue
		}

		info, err := e.Info()
		if err != nil {
			continue
		}

		head, _, _, _ := readHead(p.chatHeadPath(userID, chatID))

		out = append(out, store.ChatMeta{
			ID:      chatID,
			HeadSeq: head,
			Updated: info.ModTime(),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Updated.After(out[j].Updated)
	})

	return out, nil
}

// The head file is the commit point for appends: two big-endian int64s
// (committed sequence and log size), followed by up to 1000 event ID hashes.
// Keeping deduplication in the same atomic file prevents a crash from committing
// frames without their IDs. Older 8/16-byte heads are migrated from the log.
func readHead(path string) (seq int64, size int64, history []byte, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, -1, nil, err
	}
	if len(data) < 8 {
		return 0, -1, nil, nil
	}
	seq = int64(binary.BigEndian.Uint64(data[:8]))
	if len(data) < 16 {
		return seq, -1, nil, nil
	}
	if len(data) > 16 {
		history = data[16:]
	}
	return seq, int64(binary.BigEndian.Uint64(data[8:16])), history, nil
}

func writeHead(path string, seq, size int64, history []byte) error {
	if len(history) > dedupCapacity*dedupRecordSize {
		history = history[len(history)-dedupCapacity*dedupRecordSize:]
	}
	buf := make([]byte, 16, 16+len(history))
	binary.BigEndian.PutUint64(buf[:8], uint64(seq))
	binary.BigEndian.PutUint64(buf[8:], uint64(size))
	return writeAtomic(path, append(buf, history...))
}

// truncatePartialLine removes a trailing line that lacks a final newline,
// which would only happen if a previous append crashed mid-write.
func truncatePartialLine(path string) error {
	f, err := os.OpenFile(path, os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}

	if info.Size() == 0 {
		return nil
	}

	var last [1]byte
	if _, err := f.ReadAt(last[:], info.Size()-1); err != nil {
		return err
	}

	if last[0] == '\n' {
		return nil
	}

	// scan backwards for the last newline
	const scanChunk = 4096
	off := info.Size()
	buf := make([]byte, scanChunk)

	for off > 0 {
		readSize := int64(scanChunk)
		if off < readSize {
			readSize = off
		}
		start := off - readSize

		if _, err := f.ReadAt(buf[:readSize], start); err != nil {
			return err
		}

		for i := int(readSize) - 1; i >= 0; i-- {
			if buf[i] == '\n' {
				return f.Truncate(start + int64(i) + 1)
			}
		}
		off = start
	}

	// no newline anywhere — file was entirely a partial line
	return f.Truncate(0)
}

func eventIDDigest(id string) [dedupRecordSize]byte {
	sum := sha256.Sum256([]byte(id))
	var out [dedupRecordSize]byte
	copy(out[:], sum[:dedupRecordSize])
	return out
}

// Rebuild old dedup metadata from committed frames and legacy sidecars. The
// old writer published sidecars only after their corresponding head commit.
func rebuildDedup(path, legacyPath string, head int64) ([]byte, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), store.MaxFrameBytes+4*1024)
	var history []byte
	for scanner.Scan() {
		var line frameLine
		if json.Unmarshal(scanner.Bytes(), &line) != nil || line.Seq > head {
			continue
		}
		digest := eventIDDigest(line.ID)
		history = append(history, digest[:]...)
		if len(history) > dedupCapacity*dedupRecordSize {
			history = history[dedupRecordSize:]
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	// Old compaction retained IDs of removed frames in its sidecar. Seed
	// those IDs, then prefer the log's newer committed IDs to repair a stale
	// sidecar left by a crash between the old head and sidecar writes.
	legacy, err := os.ReadFile(legacyPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	combined := append(legacy, history...)
	seen := make(map[[dedupRecordSize]byte]bool)
	var recent []byte
	for i := len(combined) - dedupRecordSize; i >= 0 && len(recent) < dedupCapacity*dedupRecordSize; i -= dedupRecordSize {
		var digest [dedupRecordSize]byte
		copy(digest[:], combined[i:i+dedupRecordSize])
		if !seen[digest] {
			seen[digest] = true
			recent = append(recent, digest[:]...)
		}
	}
	// Restore chronological order for the next bounded head commit.
	for i, j := 0, len(recent)-dedupRecordSize; i < j; i, j = i+dedupRecordSize, j-dedupRecordSize {
		for k := 0; k < dedupRecordSize; k++ {
			recent[i+k], recent[j+k] = recent[j+k], recent[i+k]
		}
	}
	return recent, nil
}

func dedupSet(history []byte) map[[dedupRecordSize]byte]struct{} {
	set := make(map[[dedupRecordSize]byte]struct{}, len(history)/dedupRecordSize)
	for i := 0; i+dedupRecordSize <= len(history); i += dedupRecordSize {
		var record [dedupRecordSize]byte
		copy(record[:], history[i:i+dedupRecordSize])
		set[record] = struct{}{}
	}
	return set
}

type frameLine struct {
	Seq   int64  `json:"seq"`
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

func (p *Provider) AppendEvents(ctx context.Context, userID, chatID string, expectedSeq int64, eventIDs []string, frames [][]byte) (store.AppendResult, error) {
	if err := validateID(chatID); err != nil {
		return store.AppendResult{}, err
	}

	if len(eventIDs) != len(frames) {
		return store.AppendResult{}, fmt.Errorf("store: %d ids vs %d frames", len(eventIDs), len(frames))
	}

	for _, f := range frames {
		if len(f) > store.MaxFrameBytes {
			return store.AppendResult{}, store.ErrFrameTooLarge
		}
	}

	unlock, err := p.lock(ctx, userID+":"+chatID)
	if err != nil {
		return store.AppendResult{}, err
	}
	defer unlock()

	if err := ensureDir(p.chatsDir(userID)); err != nil {
		return store.AppendResult{}, err
	}

	logPath := p.chatLogPath(userID, chatID)
	headPath := p.chatHeadPath(userID, chatID)

	head, committedSize, dedupHistory, err := readHead(headPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return store.AppendResult{}, err
	}
	if errors.Is(err, os.ErrNotExist) {
		// No commit point exists yet. Even complete lines left by a failed
		// first append are uncommitted and must not survive its retry.
		committedSize = 0
	}

	if expectedSeq != head {
		return store.AppendResult{}, store.ErrSeqConflict
	}

	// Head files without a committed size can't detect orphan lines, but a
	// partial trailing line from a crashed write is still recoverable.
	if committedSize < 0 {
		if _, err := os.Stat(logPath); err == nil {
			if err := truncatePartialLine(logPath); err != nil {
				return store.AppendResult{}, err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return store.AppendResult{}, err
		}
	}

	if dedupHistory == nil && head > 0 {
		dedupHistory, err = rebuildDedup(logPath, p.chatDedupPath(userID, chatID), head)
		if err != nil {
			return store.AppendResult{}, err
		}
	}
	seenIDs := dedupSet(dedupHistory)

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return store.AppendResult{}, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return store.AppendResult{}, err
	}

	// Drop uncommitted bytes from a batch that failed before its head
	// write — leaving them would let a retry duplicate their seqs.
	size := info.Size()
	if committedSize >= 0 && committedSize < size {
		if err := f.Truncate(committedSize); err != nil {
			return store.AppendResult{}, err
		}
		size = committedSize
	}

	if _, err := f.Seek(size, io.SeekStart); err != nil {
		return store.AppendResult{}, err
	}

	deduped := make([]string, 0)
	seq := head

	for i, evID := range eventIDs {
		digest := eventIDDigest(evID)
		if _, seen := seenIDs[digest]; seen {
			deduped = append(deduped, evID)
			continue
		}

		seq++

		line, err := json.Marshal(frameLine{
			Seq:   seq,
			ID:    evID,
			Frame: string(frames[i]),
		})
		if err != nil {
			return store.AppendResult{}, err
		}
		line = append(line, '\n')

		n, err := f.Write(line)
		if err != nil {
			return store.AppendResult{}, err
		}
		size += int64(n)

		seenIDs[digest] = struct{}{}
		dedupHistory = append(dedupHistory, digest[:]...)
	}

	if err := f.Sync(); err != nil {
		return store.AppendResult{}, err
	}

	if err := writeHead(headPath, seq, size, dedupHistory); err != nil {
		return store.AppendResult{}, err
	}

	return store.AppendResult{NewSeq: seq, Deduped: deduped}, nil
}

func (p *Provider) ReadEvents(ctx context.Context, userID, chatID string, fromSeq int64) (io.ReadCloser, error) {
	if err := validateID(chatID); err != nil {
		return nil, err
	}

	unlock, err := p.lock(ctx, userID+":"+chatID)
	if err != nil {
		return nil, err
	}
	defer unlock()

	logPath := p.chatLogPath(userID, chatID)

	f, err := os.Open(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return io.NopCloser(bytesEmpty{}), nil
	}
	if err != nil {
		return nil, err
	}

	// Never stream past the committed head — bytes beyond it belong to a
	// batch that failed before its commit and will be truncated away.
	head, _, _, err := readHead(p.chatHeadPath(userID, chatID))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		f.Close()
		return nil, err
	}

	pr, pw := io.Pipe()

	go func() {
		defer f.Close()
		defer pw.Close()

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), store.MaxFrameBytes+4*1024)

		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}

			var fl frameLine
			if err := json.Unmarshal(line, &fl); err != nil {
				// skip malformed lines silently — they would only exist
				// after a partial write we already truncated, but be safe
				continue
			}

			if fl.Seq <= fromSeq || fl.Seq > head {
				continue
			}

			if _, err := pw.Write(append(line, '\n')); err != nil {
				return
			}
		}

		if err := scanner.Err(); err != nil {
			pw.CloseWithError(err)
		}
	}()

	return pr, nil
}

type bytesEmpty struct{}

func (bytesEmpty) Read(p []byte) (int, error) { return 0, io.EOF }

func (p *Provider) CompactChat(ctx context.Context, userID, chatID string, beforeSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	if beforeSeq <= 1 {
		return nil // nothing to truncate
	}

	unlock, err := p.lock(ctx, userID+":"+chatID)
	if err != nil {
		return err
	}
	defer unlock()

	logPath := p.chatLogPath(userID, chatID)
	src, err := os.Open(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer src.Close()

	head, _, dedupHistory, err := readHead(p.chatHeadPath(userID, chatID))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	if dedupHistory == nil && head > 0 {
		dedupHistory, err = rebuildDedup(logPath, p.chatDedupPath(userID, chatID), head)
		if err != nil {
			return err
		}
	}

	tmp, err := os.CreateTemp(filepath.Dir(logPath), filepath.Base(logPath)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 64*1024), store.MaxFrameBytes+4*1024)
	var size int64
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var fl frameLine
		if err := json.Unmarshal(line, &fl); err != nil {
			continue
		}
		if fl.Seq < beforeSeq || fl.Seq > head {
			continue
		}
		n, err := tmp.Write(append(line, '\n'))
		if err != nil {
			tmp.Close()
			os.Remove(tmpPath)
			return err
		}
		size += int64(n)
	}
	if err := scanner.Err(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}

	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, logPath); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return writeHead(p.chatHeadPath(userID, chatID), head, size, dedupHistory)
}

func (p *Provider) BlobExists(_ context.Context, userID, blobID string) (bool, error) {
	if err := validateID(blobID); err != nil {
		return false, err
	}
	_, err := os.Stat(p.blobPath(userID, blobID))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (p *Provider) DeleteChat(ctx context.Context, userID, chatID string) error {
	if err := validateID(chatID); err != nil {
		return err
	}

	unlock, err := p.lock(ctx, userID+":"+chatID)
	if err != nil {
		return err
	}
	defer unlock()

	for _, path := range []string{
		p.chatLogPath(userID, chatID),
		p.chatHeadPath(userID, chatID),
		p.chatDedupPath(userID, chatID),
	} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	return nil
}

// blobs ------------------------------------------------------------------

func (p *Provider) blobPath(userID, blobID string) string {
	return filepath.Join(p.blobsDir(userID), blobID)
}

func (p *Provider) GetBlob(_ context.Context, userID, blobID string) (io.ReadCloser, error) {
	if err := validateID(blobID); err != nil {
		return nil, err
	}

	f, err := os.Open(p.blobPath(userID, blobID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, store.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (p *Provider) PutBlob(_ context.Context, userID, blobID string, r io.Reader) error {
	if err := validateID(blobID); err != nil {
		return err
	}

	if err := ensureDir(p.blobsDir(userID)); err != nil {
		return err
	}

	path := p.blobPath(userID, blobID)

	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}

	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}

	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return nil
}

func (p *Provider) DeleteBlob(_ context.Context, userID, blobID string) error {
	if err := validateID(blobID); err != nil {
		return err
	}

	if err := os.Remove(p.blobPath(userID, blobID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
