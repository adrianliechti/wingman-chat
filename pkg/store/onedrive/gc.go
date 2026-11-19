package onedrive

import (
	"context"
	"log"
	"time"
)

const (
	// Nothing publishes an object this long after uploading it: relayed writes
	// publish in the same request and direct-upload tickets last 30 minutes.
	// The margin also absorbs clock skew between Graph and the backend.
	orphanAge = 24 * time.Hour
	// Each replica sweeps an account at most this often.
	orphanSweepInterval = 24 * time.Hour
)

// collectOrphans deletes data objects that no index entry references and
// that are too old to be published by an in-flight request.
func (p *Provider) collectOrphans(ctx context.Context) (int, error) {
	// List before reading the index, so anything published while listing is
	// still seen as referenced.
	objects, err := p.listObjects(ctx)
	if err != nil {
		return 0, err
	}
	state, control, err := p.readIndex(ctx)
	if err != nil {
		return 0, err
	}
	if control.ID == "" {
		// Never sweep against an index that is missing or failed to load.
		return 0, nil
	}
	referenced := map[string]bool{}
	for _, ch := range state.Chats {
		for _, part := range ch.Segments {
			referenced[part.Name] = true
		}
	}
	for _, entries := range []map[string]object{state.Files, state.Blobs} {
		for _, entry := range entries {
			referenced[entry.Name] = true
		}
	}
	cutoff := time.Now().Add(-orphanAge)
	var orphans []string
	for _, item := range objects {
		if !referenced[item.Name] && !item.Modified.IsZero() && item.Modified.Before(cutoff) {
			orphans = append(orphans, item.Name)
		}
	}
	p.removeAll(ctx, orphans)
	return len(orphans), nil
}

// sweepOrphans starts a background sweep for the request's account unless this
// replica swept it recently. It reports whether a sweep started.
func (p *Provider) sweepOrphans(ctx context.Context) bool {
	if p.sweepInterval <= 0 {
		return false
	}
	s, err := sessionFrom(ctx)
	if err != nil || s.folder == "" {
		return false
	}
	account := s.drive + "/" + s.folder
	now := time.Now()
	p.sweepMu.Lock()
	if last, ok := p.sweeps[account]; ok && now.Sub(last) < p.sweepInterval {
		p.sweepMu.Unlock()
		return false
	}
	for key, last := range p.sweeps {
		if now.Sub(last) >= p.sweepInterval {
			delete(p.sweeps, key)
		}
	}
	p.sweeps[account] = now
	p.sweepMu.Unlock()

	// Use fresh request state: the caller's session is not safe to share.
	token := s.token
	go func() {
		ctx, cancel := context.WithTimeout(WithToken(context.Background(), token), 2*time.Minute)
		defer cancel()
		n, err := p.collectOrphans(ctx)
		if err != nil {
			log.Printf("OneDrive backup: orphan sweep failed: %v", err)
		} else if n > 0 {
			log.Printf("OneDrive backup: removed %d unpublished encrypted objects", n)
		}
	}()
	return true
}
