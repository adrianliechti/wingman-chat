package onedrive

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sort"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// maxRecent bounds the per-chat event-id dedup window stored in the index.
// It only needs to cover one retried append batch: the request cap
// (maxAppendBytes in the HTTP layer) over the client's ~4 MiB frames allows
// a few dozen frames per batch.
const maxRecent = 128

type eventLine struct {
	Seq   int64  `json:"seq"`
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

func (p *Provider) ListChats(ctx context.Context, userID string) ([]store.ChatMeta, error) {
	state, err := p.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]store.ChatMeta, 0, len(state.Chats))
	for id, ch := range state.Chats {
		out = append(out, store.ChatMeta{ID: id, HeadSeq: ch.Head, Updated: ch.Updated, Deleted: ch.Deleted})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out, nil
}
func (p *Provider) AppendEvents(ctx context.Context, userID, chatID string, expectedSeq int64, eventIDs []string, frames [][]byte) (store.AppendResult, error) {
	if err := validateID(chatID); err != nil {
		return store.AppendResult{}, err
	}
	if len(eventIDs) != len(frames) {
		return store.AppendResult{}, errors.New("OneDrive backup: event/frame count mismatch")
	}
	for _, frame := range frames {
		if len(frame) > store.MaxFrameBytes {
			return store.AppendResult{}, store.ErrFrameTooLarge
		}
	}
	state, err := p.load(ctx, userID)
	if err != nil {
		return store.AppendResult{}, err
	}
	ch := state.Chats[chatID]
	if ch.Head != expectedSeq {
		return store.AppendResult{}, store.ErrSeqConflict
	}
	result := store.AppendResult{NewSeq: ch.Head}
	seen := make(map[string]bool, len(ch.Recent))
	for _, id := range ch.Recent {
		seen[id] = true
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	first := ch.Head + 1
	for i, id := range eventIDs {
		hash := digest([]byte(id))[:32]
		if seen[hash] {
			result.Deduped = append(result.Deduped, id)
			continue
		}
		seen[hash] = true
		ch.Head++
		if err := encoder.Encode(eventLine{Seq: ch.Head, ID: id, Frame: string(frames[i])}); err != nil {
			return result, err
		}
		ch.Recent = append(ch.Recent, hash)
	}
	if buffer.Len() == 0 {
		return result, nil
	}
	ch.Recent = trimRecent(ch.Recent)
	part := segment{object: object{Name: newObject(), Updated: time.Now().UTC()}, First: first, Last: ch.Head}
	part.ETag, part.Size, err = p.upload(ctx, userID, part.Name, &buffer)
	if err != nil {
		return result, err
	}
	ch.Segments = append(ch.Segments, part)
	ch.Updated = part.Updated
	ch.Deleted = false
	state.Chats[chatID] = ch
	if err := p.save(ctx, userID, state); err != nil {
		p.discard(ctx, userID, err, part.Name)
		return result, err
	}
	result.NewSeq = ch.Head
	return result, nil
}

func trimRecent(recent []string) []string {
	if len(recent) > maxRecent {
		return append([]string(nil), recent[len(recent)-maxRecent:]...)
	}
	return recent
}

// eventReader opens one immutable segment at a time, bounds memory to one frame,
// and propagates download failures rather than buffering an entire chat log.
type eventReader struct {
	provider *Provider
	ctx      context.Context
	userID   string
	parts    []segment
	from     int64
	source   io.ReadCloser
	scanner  *bufio.Scanner
	pending  *bytes.Reader
}

func (r *eventReader) next() error {
	if len(r.parts) == 0 {
		return io.EOF
	}
	source, err := r.provider.open(r.ctx, r.userID, r.parts[0].Name)
	if errors.Is(err, store.ErrNotFound) {
		// A concurrent compaction or delete removed a segment the snapshot listed.
		return store.ErrBackupConflict
	}
	if err != nil {
		return err
	}
	r.parts = r.parts[1:]
	r.source = source
	r.scanner = bufio.NewScanner(source)
	r.scanner.Buffer(make([]byte, 64<<10), store.MaxFrameBytes*2)
	return nil
}
func (r *eventReader) Read(dst []byte) (int, error) {
	if len(dst) == 0 {
		return 0, nil
	}
	for {
		if r.pending != nil && r.pending.Len() > 0 {
			return r.pending.Read(dst)
		}
		if r.scanner == nil {
			if err := r.next(); err != nil {
				return 0, err
			}
		}
		if r.scanner.Scan() {
			line := r.scanner.Bytes()
			var head struct {
				Seq int64 `json:"seq"`
			}
			if err := json.Unmarshal(line, &head); err != nil {
				return 0, errors.New("OneDrive backup: invalid event segment")
			}
			if head.Seq > r.from {
				r.pending = bytes.NewReader(append(append([]byte(nil), line...), '\n'))
			}
			continue
		}
		err := r.scanner.Err()
		r.source.Close()
		r.source, r.scanner = nil, nil
		if err != nil {
			return 0, err
		}
	}
}
func (r *eventReader) Close() error {
	r.parts = nil
	if r.source != nil {
		return r.source.Close()
	}
	return nil
}
func (p *Provider) ReadEvents(ctx context.Context, userID, chatID string, fromSeq int64) (io.ReadCloser, error) {
	if err := validateID(chatID); err != nil {
		return nil, err
	}
	state, err := p.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	ch, ok := state.Chats[chatID]
	if !ok || ch.Deleted {
		return nil, store.ErrNotFound
	}
	reader := &eventReader{provider: p, ctx: ctx, userID: userID, from: fromSeq}
	for _, part := range ch.Segments {
		if part.Last > fromSeq {
			reader.parts = append(reader.parts, part)
		}
	}
	if len(reader.parts) > 0 {
		name := reader.parts[0].Name
		if err := reader.next(); err != nil {
			if errors.Is(err, store.ErrBackupConflict) {
				err = p.missingData(ctx, userID, func(current *index) bool {
					return slices.ContainsFunc(current.Chats[chatID].Segments, func(part segment) bool { return part.Name == name })
				})
			}
			return nil, err
		}
	}
	return reader, nil
}
func (p *Provider) DeleteChat(ctx context.Context, userID, chatID string, expectedSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	state, err := p.load(ctx, userID)
	if err != nil {
		return err
	}
	ch, ok := state.Chats[chatID]
	if !ok || ch.Deleted {
		return nil
	}
	if ch.Head != expectedSeq {
		return store.ErrSeqConflict
	}
	// Keep an advanced cursor after deletion. A pending local edit can recreate
	// this ID with an init snapshot, while stale devices cannot reuse its head.
	state.Chats[chatID] = chat{Head: ch.Head + 1, Deleted: true, Updated: time.Now().UTC()}
	if err := p.save(ctx, userID, state); err != nil {
		return err
	}
	for _, part := range ch.Segments {
		_ = p.remove(ctx, userID, part.Name)
	}
	return nil
}
func (p *Provider) CompactChat(ctx context.Context, userID, chatID string, beforeSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	state, err := p.load(ctx, userID)
	if err != nil {
		return err
	}
	ch, ok := state.Chats[chatID]
	if !ok || ch.Deleted {
		return store.ErrNotFound
	}
	if beforeSeq > ch.Head {
		return fmt.Errorf("OneDrive backup: compact beyond chat head")
	}
	var retained []segment
	var removed, uploaded []string
	for _, part := range ch.Segments {
		switch {
		case part.Last < beforeSeq:
			removed = append(removed, part.Name)
		case part.First >= beforeSeq:
			retained = append(retained, part)
		default:
			reader := &eventReader{provider: p, ctx: ctx, userID: userID, parts: []segment{part}, from: beforeSeq - 1}
			replacement := segment{object: object{Name: newObject(), Updated: time.Now().UTC()}, First: beforeSeq, Last: part.Last}
			replacement.ETag, replacement.Size, err = p.upload(ctx, userID, replacement.Name, reader)
			reader.Close()
			if err != nil {
				return err
			}
			uploaded = append(uploaded, replacement.Name)
			retained = append(retained, replacement)
			removed = append(removed, part.Name)
		}
	}
	if len(removed) == 0 {
		return nil
	}
	ch.Segments = retained
	// Also shrinks dedup lists written by older versions (up to 1000 hashes).
	ch.Recent = trimRecent(ch.Recent)
	state.Chats[chatID] = ch
	if err := p.save(ctx, userID, state); err != nil {
		p.discard(ctx, userID, err, uploaded...)
		return err
	}
	for _, name := range removed {
		_ = p.remove(ctx, userID, name)
	}
	return nil
}
