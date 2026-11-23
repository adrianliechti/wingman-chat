package onedrive

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"slices"
	"sort"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// maxRecent bounds the per-chat event-id dedup window stored in the index.
// It only needs to cover one retried append batch: the request cap
// (store.MaxAppendBytes) over the client's ~4 MiB frames allows
// a few dozen frames per batch.
const maxRecent = 128

type eventLine struct {
	Seq   int64  `json:"seq"`
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

func (p *Provider) ListChats(ctx context.Context) ([]store.ChatMeta, error) {
	state, err := p.load(ctx)
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

func (p *Provider) AppendEventStream(ctx context.Context, chatID string, expectedSeq int64, events iter.Seq2[store.EventFrame, error]) (store.AppendResult, error) {
	if err := validateID(chatID); err != nil {
		return store.AppendResult{}, err
	}
	state, err := p.load(ctx)
	if err != nil {
		return store.AppendResult{}, err
	}
	ch := state.Chats[chatID]
	if ch.Head != expectedSeq {
		return store.AppendResult{}, store.ErrSeqConflict
	}
	updated, result, spooled, err := p.prepareAppend(ch, events)
	if err != nil || spooled == nil {
		return result, err
	}
	defer spooled.close()
	name := updated.Segments[len(updated.Segments)-1].Name
	if err := p.send(ctx, name, spooled); err != nil {
		return store.AppendResult{}, err
	}
	state.Chats[chatID] = updated
	if err := p.save(ctx, state); err != nil {
		p.discard(ctx, err, name)
		return store.AppendResult{}, err
	}
	return result, nil
}

// prepareAppend fully validates and spools a chat's events before publishing.
func (p *Provider) prepareAppend(ch chat, events iter.Seq2[store.EventFrame, error]) (chat, store.AppendResult, *spooledObject, error) {
	result := store.AppendResult{NewSeq: ch.Head}
	seen := make(map[string]bool, len(ch.Recent))
	for _, id := range ch.Recent {
		seen[id] = true
	}
	first := ch.Head + 1
	spooled, err := p.writeSpool(func(w io.Writer) error {
		encoder := json.NewEncoder(w)
		for event, err := range events {
			if err != nil {
				return err
			}
			if len(event.Frame) > store.MaxFrameBytes {
				return store.ErrFrameTooLarge
			}
			hash := digest([]byte(event.ID))[:32]
			if seen[hash] {
				result.Deduped = append(result.Deduped, event.ID)
				continue
			}
			seen[hash] = true
			ch.Head++
			if err := encoder.Encode(eventLine{Seq: ch.Head, ID: event.ID, Frame: event.Frame}); err != nil {
				return err
			}
			ch.Recent = append(ch.Recent, hash)
		}
		return nil
	})
	if err != nil {
		return chat{}, store.AppendResult{}, nil, err
	}
	if spooled.size == 0 {
		spooled.close()
		return ch, result, nil, nil
	}
	if len(ch.Recent) > maxRecent {
		ch.Recent = slices.Clone(ch.Recent[len(ch.Recent)-maxRecent:])
	}
	part := segment{object: object{Name: newObject(), ETag: spooled.etag, Size: spooled.size, Updated: time.Now().UTC()}, First: first, Last: ch.Head}
	ch.Segments = append(ch.Segments, part)
	ch.Updated = part.Updated
	ch.Deleted = false
	result.NewSeq = ch.Head
	return ch, result, spooled, nil
}

func (p *Provider) AppendChatBatch(ctx context.Context, writes []store.ChatAppend) ([]*store.AppendResult, error) {
	seen := make(map[string]bool, len(writes))
	for _, write := range writes {
		if err := validateID(write.ID); err != nil {
			return nil, err
		}
		if seen[write.ID] {
			return nil, store.ErrInvalidID
		}
		seen[write.ID] = true
	}
	state, err := p.load(ctx)
	if err != nil {
		return nil, err
	}

	type pendingAppend struct {
		id      string
		updated chat
		name    string
		spool   *spooledObject
	}
	var pending []pendingAppend
	var names []string
	defer func() {
		for _, append := range pending {
			append.spool.close()
		}
	}()
	results := make([]*store.AppendResult, len(writes))
	for i, write := range writes {
		current := state.Chats[write.ID]
		if current.Head != write.ExpectedSeq {
			continue
		}
		updated, result, spooled, err := p.prepareAppend(current, func(yield func(store.EventFrame, error) bool) {
			for _, event := range write.Events {
				if !yield(event, nil) {
					return
				}
			}
		})
		if err != nil {
			return nil, err
		}
		results[i] = &result
		if spooled != nil {
			name := updated.Segments[len(updated.Segments)-1].Name
			pending = append(pending, pendingAppend{write.ID, updated, name, spooled})
			names = append(names, name)
		}
	}
	if len(pending) == 0 {
		return results, nil
	}
	if err := p.parallel(ctx, len(pending), func(ctx context.Context, i int) error {
		item := pending[i]
		return p.send(ctx, item.name, item.spool)
	}); err != nil {
		p.removeAll(ctx, names)
		return nil, err
	}
	for _, append := range pending {
		state.Chats[append.id] = append.updated
	}
	if err := p.save(ctx, state); err != nil {
		p.discard(ctx, err, names...)
		return nil, err
	}
	return results, nil
}

// eventReader opens one immutable segment at a time, bounds memory to one frame,
// and propagates download failures rather than buffering an entire chat log.
type eventReader struct {
	provider *Provider
	ctx      context.Context
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
	source, err := r.provider.open(r.ctx, r.parts[0].Name)
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
func (p *Provider) ReadEvents(ctx context.Context, chatID string, fromSeq int64) (io.ReadCloser, error) {
	if err := validateID(chatID); err != nil {
		return nil, err
	}
	state, err := p.load(ctx)
	if err != nil {
		return nil, err
	}
	ch, ok := state.Chats[chatID]
	if !ok || ch.Deleted {
		return nil, store.ErrNotFound
	}
	reader := &eventReader{provider: p, ctx: ctx, from: fromSeq}
	for _, part := range ch.Segments {
		if part.Last > fromSeq {
			reader.parts = append(reader.parts, part)
		}
	}
	if len(reader.parts) > 0 {
		name := reader.parts[0].Name
		if err := reader.next(); err != nil {
			if errors.Is(err, store.ErrBackupConflict) {
				err = p.missingData(ctx, func(current *index) bool {
					return slices.ContainsFunc(current.Chats[chatID].Segments, func(part segment) bool { return part.Name == name })
				})
			}
			return nil, err
		}
	}
	return reader, nil
}
func (p *Provider) DeleteChat(ctx context.Context, chatID string, expectedSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	state, err := p.load(ctx)
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
	if err := p.save(ctx, state); err != nil {
		return err
	}
	names := make([]string, len(ch.Segments))
	for i, part := range ch.Segments {
		names[i] = part.Name
	}
	p.removeLater(ctx, names...)
	return nil
}
func (p *Provider) CompactChat(ctx context.Context, chatID string, beforeSeq int64) error {
	if err := validateID(chatID); err != nil {
		return err
	}
	state, err := p.load(ctx)
	if err != nil {
		return err
	}
	ch, ok := state.Chats[chatID]
	if !ok || ch.Deleted {
		return store.ErrNotFound
	}
	if beforeSeq > ch.Head {
		return fmt.Errorf("%w: compact beyond chat head", store.ErrInvalidRequest)
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
			reader := &eventReader{provider: p, ctx: ctx, parts: []segment{part}, from: beforeSeq - 1}
			replacement := segment{object: object{Name: newObject(), Updated: time.Now().UTC()}, First: beforeSeq, Last: part.Last}
			replacement.ETag, replacement.Size, err = p.upload(ctx, replacement.Name, reader)
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
	state.Chats[chatID] = ch
	if err := p.save(ctx, state); err != nil {
		p.discard(ctx, err, uploaded...)
		return err
	}
	p.removeLater(ctx, removed...)
	return nil
}
