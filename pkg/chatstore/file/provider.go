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
	"sync"

	"github.com/adrianliechti/wingman-chat/pkg/chatstore"
)

var _ chatstore.Provider = (*Provider)(nil)

// Provider is a file-backed implementation of chatstore.Provider.
//
// Layout:
//
//	{root}/{sha256(userID)[:32]}/
//	    keystore.json
//	    keystore.prev.json    (one-version backup)
//	    chats/{chatID}.jsonl
//	    chats/{chatID}.head   (8-byte big-endian head seq)
//	    chats/{chatID}.ids    (binary LRU of last 1000 event_ids)
//	    blobs/{blobID}
type Provider struct {
	root string

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// uuidLike permits UUIDs as well as similarly-shaped opaque IDs the
// client may generate — anything outside the alphabet/length is refused.
var uuidLike = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

const (
	dedupCapacity   = 1000
	dedupRecordSize = 16 // sha1-truncated hash of eventID
)

func New(root string) (*Provider, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, err
	}

	return &Provider{
		root:  abs,
		locks: make(map[string]*sync.Mutex),
	}, nil
}

func (p *Provider) lockFor(key string) *sync.Mutex {
	p.mu.Lock()
	defer p.mu.Unlock()

	if m, ok := p.locks[key]; ok {
		return m
	}

	m := &sync.Mutex{}
	p.locks[key] = m
	return m
}

func userHash(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(sum[:16]) // 32 hex chars
}

func validateID(id string) error {
	if !uuidLike.MatchString(id) {
		return chatstore.ErrInvalidID
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
		return nil, "", chatstore.ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return data, etagOf(data), nil
}

func (p *Provider) PutKeystore(_ context.Context, userID string, data []byte, ifMatch string) (string, error) {
	lock := p.lockFor("keystore:" + userID)
	lock.Lock()
	defer lock.Unlock()

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
			return "", chatstore.ErrKeystoreConflict
		}
	default:
		if !exists || etagOf(current) != ifMatch {
			return "", chatstore.ErrKeystoreConflict
		}
	}

	if exists {
		if err := writeAtomic(p.keystoreBackupPath(userID), current); err != nil {
			return "", err
		}
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

func (p *Provider) ListChats(_ context.Context, userID string) ([]chatstore.ChatMeta, error) {
	dir := p.chatsDir(userID)

	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []chatstore.ChatMeta{}, nil
	}
	if err != nil {
		return nil, err
	}

	out := make([]chatstore.ChatMeta, 0, len(entries))

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

		head, _ := readHead(p.chatHeadPath(userID, chatID))

		out = append(out, chatstore.ChatMeta{
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

func readHead(path string) (int64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	if len(data) < 8 {
		return 0, nil
	}
	return int64(binary.BigEndian.Uint64(data[:8])), nil
}

func writeHead(path string, seq int64) error {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(seq))
	return writeAtomic(path, buf[:])
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

// loadDedup returns the in-memory dedup set for a chat (recent eventIDs).
func loadDedup(path string) (map[[dedupRecordSize]byte]struct{}, []byte, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[[dedupRecordSize]byte]struct{}{}, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	set := make(map[[dedupRecordSize]byte]struct{}, len(data)/dedupRecordSize)

	for i := 0; i+dedupRecordSize <= len(data); i += dedupRecordSize {
		var rec [dedupRecordSize]byte
		copy(rec[:], data[i:i+dedupRecordSize])
		set[rec] = struct{}{}
	}

	return set, data, nil
}

func saveDedup(path string, history []byte) error {
	if len(history) > dedupCapacity*dedupRecordSize {
		history = history[len(history)-dedupCapacity*dedupRecordSize:]
	}
	return writeAtomic(path, history)
}

type frameLine struct {
	Seq   int64  `json:"seq"`
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

func (p *Provider) AppendEvents(_ context.Context, userID, chatID string, expectedSeq int64, eventIDs []string, frames [][]byte) (chatstore.AppendResult, error) {
	if err := validateID(chatID); err != nil {
		return chatstore.AppendResult{}, err
	}

	if len(eventIDs) != len(frames) {
		return chatstore.AppendResult{}, fmt.Errorf("chatstore: %d ids vs %d frames", len(eventIDs), len(frames))
	}

	for _, f := range frames {
		if len(f) > chatstore.MaxFrameBytes {
			return chatstore.AppendResult{}, chatstore.ErrFrameTooLarge
		}
	}

	lock := p.lockFor(userID + ":" + chatID)
	lock.Lock()
	defer lock.Unlock()

	if err := ensureDir(p.chatsDir(userID)); err != nil {
		return chatstore.AppendResult{}, err
	}

	logPath := p.chatLogPath(userID, chatID)

	if _, err := os.Stat(logPath); err == nil {
		if err := truncatePartialLine(logPath); err != nil {
			return chatstore.AppendResult{}, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return chatstore.AppendResult{}, err
	}

	head, err := readHead(p.chatHeadPath(userID, chatID))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return chatstore.AppendResult{}, err
	}

	if expectedSeq != head {
		return chatstore.AppendResult{}, chatstore.ErrSeqConflict
	}

	dedupPath := p.chatDedupPath(userID, chatID)
	dedupSet, dedupHistory, err := loadDedup(dedupPath)
	if err != nil {
		return chatstore.AppendResult{}, err
	}

	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return chatstore.AppendResult{}, err
	}
	defer f.Close()

	deduped := make([]string, 0)
	seq := head

	for i, evID := range eventIDs {
		digest := eventIDDigest(evID)
		if _, seen := dedupSet[digest]; seen {
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
			return chatstore.AppendResult{}, err
		}
		line = append(line, '\n')

		if _, err := f.Write(line); err != nil {
			return chatstore.AppendResult{}, err
		}

		dedupSet[digest] = struct{}{}
		dedupHistory = append(dedupHistory, digest[:]...)
	}

	if err := f.Sync(); err != nil {
		return chatstore.AppendResult{}, err
	}

	if seq != head {
		if err := writeHead(p.chatHeadPath(userID, chatID), seq); err != nil {
			return chatstore.AppendResult{}, err
		}
	}

	if err := saveDedup(dedupPath, dedupHistory); err != nil {
		return chatstore.AppendResult{}, err
	}

	return chatstore.AppendResult{NewSeq: seq, Deduped: deduped}, nil
}

func (p *Provider) ReadEvents(_ context.Context, userID, chatID string, fromSeq int64) (io.ReadCloser, error) {
	if err := validateID(chatID); err != nil {
		return nil, err
	}

	logPath := p.chatLogPath(userID, chatID)

	f, err := os.Open(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return io.NopCloser(bytesEmpty{}), nil
	}
	if err != nil {
		return nil, err
	}

	pr, pw := io.Pipe()

	go func() {
		defer f.Close()
		defer pw.Close()

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), chatstore.MaxFrameBytes+4*1024)

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

			if fl.Seq <= fromSeq {
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

func (p *Provider) CompactChat(_ context.Context, userID, chatID string, beforeSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	if beforeSeq <= 1 {
		return nil // nothing to truncate
	}

	lock := p.lockFor(userID + ":" + chatID)
	lock.Lock()
	defer lock.Unlock()

	logPath := p.chatLogPath(userID, chatID)
	src, err := os.Open(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer src.Close()

	tmp, err := os.CreateTemp(filepath.Dir(logPath), filepath.Base(logPath)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 64*1024), chatstore.MaxFrameBytes+4*1024)
	kept := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var fl frameLine
		if err := json.Unmarshal(line, &fl); err != nil {
			continue
		}
		if fl.Seq < beforeSeq {
			continue
		}
		if _, err := tmp.Write(append(line, '\n')); err != nil {
			tmp.Close()
			os.Remove(tmpPath)
			return err
		}
		kept++
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
	return nil
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

func (p *Provider) DeleteChat(_ context.Context, userID, chatID string) error {
	if err := validateID(chatID); err != nil {
		return err
	}

	lock := p.lockFor(userID + ":" + chatID)
	lock.Lock()
	defer lock.Unlock()

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
		return nil, chatstore.ErrNotFound
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
