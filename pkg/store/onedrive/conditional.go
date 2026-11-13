package onedrive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// Fail closed if a Graph backend does not enforce conditional content writes.
// The probe has a unique name and never touches the backup index or ciphertext.
// Successful checks are cached per account folder for this provider's lifetime.
func (p *Provider) verifyConditionalWrites(ctx context.Context, userID string) error {
	folder, err := p.folder(ctx, userID)
	if err != nil {
		return err
	}
	cacheKey := userID + "\x00" + folder
	p.conditionalMu.Lock()
	verified := p.conditional[cacheKey]
	p.conditionalMu.Unlock()
	if verified {
		return nil
	}
	name := "probe-" + strings.TrimPrefix(newObject(), "data-") + ".json"
	endpoint, err := p.objectURL(ctx, userID, name)
	if err != nil {
		return err
	}
	res, err := p.request(ctx, "PUT", endpoint+":/content?%40microsoft.graph.conflictBehavior=fail", bytes.NewReader([]byte("{}")), http.Header{"Content-Type": {"application/json"}}, true)
	if err != nil {
		return err
	}
	defer func() { _ = p.remove(ctx, userID, name) }()
	var item driveItem
	decodeErr := json.NewDecoder(res.Body).Decode(&item)
	res.Body.Close()
	if decodeErr != nil {
		return decodeErr
	}
	if item.ID == "" || item.ETag == "" {
		return errors.New("OneDrive backup: missing conditional-write probe identity or ETag")
	}
	// Verify create-only semantics independently of If-None-Match support.
	res, err = p.request(ctx, "PUT", endpoint+":/content?%40microsoft.graph.conflictBehavior=fail", bytes.NewReader([]byte(`{"unsafe":true}`)), http.Header{"Content-Type": {"application/json"}}, true)
	if err == nil {
		res.Body.Close()
		return errors.New("OneDrive backup: storage does not enforce create-only uploads; refusing unsafe index writes")
	}
	if statusIs(err, http.StatusNotFound) {
		return store.ErrBackupConflict
	}
	if !statusIs(err, http.StatusConflict) && !statusIs(err, http.StatusPreconditionFailed) {
		return err
	}
	// Obtain a genuinely stale, service-issued ETag rather than inventing one:
	// some backends reject an unfamiliar ETag format before checking freshness.
	itemURL := p.base + "/me/drive/items/" + url.PathEscape(item.ID) + "/content"
	headers := http.Header{"Content-Type": {"application/json"}, "If-Match": {item.ETag}}
	const expected = `{"probe":1}`
	res, err = p.request(ctx, "PUT", itemURL, strings.NewReader(expected), headers, true)
	if statusIs(err, http.StatusNotFound) || statusIs(err, http.StatusPreconditionFailed) {
		return store.ErrBackupConflict
	}
	if err != nil {
		return err
	}
	var updated driveItem
	decodeErr = json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if decodeErr != nil {
		return decodeErr
	}
	if updated.ID != item.ID || updated.ETag == "" || updated.ETag == item.ETag {
		return errors.New("OneDrive backup: conditional-write probe ETag did not advance")
	}
	res, err = p.request(ctx, "PUT", itemURL, bytes.NewReader([]byte(`{"unsafe":true}`)), headers, true)
	if err == nil {
		res.Body.Close()
		return errors.New("OneDrive backup: storage does not enforce If-Match; refusing unsafe index writes")
	}
	if statusIs(err, http.StatusNotFound) {
		return store.ErrBackupConflict
	}
	if !statusIs(err, http.StatusPreconditionFailed) {
		return err
	}
	reader, err := p.open(ctx, userID, name)
	if errors.Is(err, store.ErrNotFound) {
		return store.ErrBackupConflict
	}
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(reader, int64(len(expected)+1)))
	reader.Close()
	if err != nil {
		return err
	}
	if string(data) != expected {
		return errors.New("OneDrive backup: conditional-write probe was modified; refusing unsafe index writes")
	}
	p.conditionalMu.Lock()
	// Bound memory independently of how many accounts the deployment serves.
	if len(p.conditional) >= 4096 {
		clear(p.conditional)
	}
	p.conditional[cacheKey] = true
	p.conditionalMu.Unlock()
	return nil
}
