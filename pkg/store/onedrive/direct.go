package onedrive

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// The ticket carries the reservation between requests and replicas. Graph's
// upload URL itself is only sent to the browser.
type uploadTicket struct {
	Drive, Folder, Generation, Keystore string
	ID, Name, Previous                  string
	Kind                                store.ObjectKind
	Size                                int64
	Expires                             int64
}

func (p *Provider) StartUpload(ctx context.Context, kind store.ObjectKind, id string, size int64, ifMatch string) (store.UploadSession, error) {
	if !p.DirectUploadsEnabled() {
		return store.UploadSession{}, store.ErrDirectUnavailable
	}
	if size > store.MaxObjectBytes {
		return store.UploadSession{}, &http.MaxBytesError{Limit: store.MaxObjectBytes}
	}
	if size <= uploadChunk {
		return store.UploadSession{}, store.ErrInvalidUpload
	}
	if err := validateID(id); err != nil {
		return store.UploadSession{}, err
	}
	state, err := p.load(ctx)
	if err != nil {
		return store.UploadSession{}, err
	}
	s, _ := sessionFrom(ctx)
	if s.drive == "" {
		return store.UploadSession{}, store.ErrDirectUnavailable
	}
	objects, err := objectEntries(state, kind)
	if err != nil {
		return store.UploadSession{}, err
	}
	previous, exists := objects[id]
	if !matches(ifMatch, previous.ETag, exists) {
		return store.UploadSession{}, store.ErrObjectConflict
	}
	name := newObject()
	endpoint, err := p.objectURL(ctx, name)
	if err != nil {
		return store.UploadSession{}, err
	}
	graphSession, err := p.createUploadSession(ctx, endpoint, "fail")
	if err != nil {
		return store.UploadSession{}, err
	}
	now := time.Now()
	expires := graphSession.ExpiresAt
	if !expires.After(now) {
		return store.UploadSession{}, store.ErrDirectUnavailable
	}
	if limit := now.Add(30 * time.Minute); expires.After(limit) {
		expires = limit
	}
	ticket := uploadTicket{
		Drive: s.drive, Folder: s.folder, Generation: state.Generation, Keystore: digest(state.Keystore),
		ID: id, Name: name, Previous: previous.Name, Kind: kind, Size: size, Expires: expires.Unix(),
	}
	data, err := json.Marshal(ticket)
	if err != nil {
		return store.UploadSession{}, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(p.signUpload(data))
	// Direct uploads are the main source of unpublished objects.
	p.sweepOrphans(ctx)
	return store.UploadSession{URL: graphSession.URL, Ticket: encoded, ExpiresAt: expires}, nil
}

func (p *Provider) signUpload(data []byte) []byte {
	mac := hmac.New(sha256.New, p.uploadKey)
	mac.Write(data)
	return mac.Sum(nil)
}

func (p *Provider) parseUploadTicket(encoded string) (uploadTicket, error) {
	var ticket uploadTicket
	message, signature, ok := strings.Cut(encoded, ".")
	if !ok {
		return ticket, store.ErrInvalidUpload
	}
	data, err := base64.RawURLEncoding.DecodeString(message)
	if err != nil {
		return ticket, store.ErrInvalidUpload
	}
	mac, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(mac, p.signUpload(data)) || json.Unmarshal(data, &ticket) != nil {
		return ticket, store.ErrInvalidUpload
	}
	if time.Now().Unix() >= ticket.Expires {
		return ticket, store.ErrBackupConflict
	}
	return ticket, nil
}

func (t uploadTicket) matchesBackup(state *index) bool {
	return t.Generation == state.Generation && t.Keystore == digest(state.Keystore)
}

func (p *Provider) CompleteUpload(ctx context.Context, kind store.ObjectKind, id, encoded, hash, quickXor string) (string, error) {
	if !p.DirectUploadsEnabled() {
		return "", store.ErrDirectUnavailable
	}
	ticket, err := p.parseUploadTicket(encoded)
	if err != nil {
		return "", err
	}
	sha, shaErr := hex.DecodeString(hash)
	quick, quickErr := base64.StdEncoding.DecodeString(quickXor)
	if ticket.ID != id || ticket.Kind != kind || shaErr != nil || len(sha) != sha256.Size || quickErr != nil || len(quick) != 20 {
		return "", store.ErrInvalidUpload
	}
	hash = hex.EncodeToString(sha)
	state, err := p.load(ctx)
	if err != nil {
		return "", err
	}
	s, _ := sessionFrom(ctx)
	if s.folder != ticket.Folder || s.drive != ticket.Drive || !ticket.matchesBackup(state) {
		return "", store.ErrBackupConflict
	}
	objects, err := objectEntries(state, kind)
	if err != nil {
		return "", err
	}
	previous := objects[id]
	if previous.Name == ticket.Name {
		if previous.ETag != hash {
			return "", store.ErrInvalidUpload
		}
		return hash, nil
	}
	if previous.Name != ticket.Previous {
		// The three-way index merge rejects any concurrent completion of this
		// ticket too, so the reserved object can never be published.
		p.removeAll(ctx, []string{ticket.Name})
		return "", store.ErrObjectConflict
	}

	endpoint, err := p.objectURL(ctx, ticket.Name)
	if err != nil {
		return "", err
	}
	var item driveItem
	err = p.jsonRequest(ctx, "GET", endpoint+"?$select=id,size,file", nil, &item)
	if statusIs(err, http.StatusNotFound) {
		return "", store.ErrUploadIncomplete
	}
	if err != nil {
		return "", err
	}
	if item.ID == "" || item.File.Hashes.QuickXor == "" {
		return "", store.ErrUploadIncomplete
	}
	if item.Size != ticket.Size || item.File.Hashes.QuickXor != base64.StdEncoding.EncodeToString(quick) {
		p.removeAll(ctx, []string{ticket.Name})
		return "", store.ErrInvalidUpload
	}

	// The server never sees the ciphertext, so the SHA-256 ETag is the
	// client's claim. Size and QuickXorHash are checked against OneDrive.
	objects[id] = object{Name: ticket.Name, ETag: hash, Size: item.Size, Updated: time.Now().UTC()}
	if err := p.save(ctx, state); err != nil {
		// Another finalize of this ticket may have published the same object.
		// Keep the object on failure rather than risk deleting a committed file.
		if definiteConflict(err) {
			current, _, readErr := p.readIndex(ctx)
			if readErr == nil && ticket.matchesBackup(current) {
				entries, _ := objectEntries(current, kind)
				if winner := entries[id]; winner.Name == ticket.Name && winner.ETag == hash {
					return hash, nil
				}
			}
		}
		return "", err
	}
	if previous.Name != "" {
		p.removeLater(ctx, previous.Name)
	}
	return hash, nil
}
