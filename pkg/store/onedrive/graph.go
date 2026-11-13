package onedrive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

const uploadChunk = 10 * 1024 * 1024 // Multiple of Graph's 320 KiB fragment size.

type graphError struct {
	status     int
	retryAfter time.Duration
}

func (e *graphError) Error() string {
	return fmt.Sprintf("OneDrive backup: Microsoft Graph returned HTTP %d", e.status)
}

// HTTPStatus and RetryAfter let the HTTP layer pass through actionable Graph
// failures (auth, quota, throttling) without depending on this package.
func (e *graphError) HTTPStatus() int           { return e.status }
func (e *graphError) RetryAfter() time.Duration { return e.retryAfter }
func retryAfter(header string) time.Duration {
	if seconds, err := strconv.Atoi(header); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if until, err := http.ParseTime(header); err == nil && time.Until(until) > 0 {
		return time.Until(until)
	}
	return 0
}
func statusIs(err error, status int) bool {
	var e *graphError
	return errors.As(err, &e) && e.status == status
}

// request only sends the bearer token to Graph. Upload-session URLs are already
// authorized and must never receive it. Errors deliberately omit URLs and bodies
// because upload URLs contain credentials.
func (p *Provider) request(ctx context.Context, method, endpoint string, body io.ReadSeeker, headers http.Header, auth bool) (*http.Response, error) {
	for attempt := 0; attempt < 3; attempt++ {
		if body != nil {
			if _, err := body.Seek(0, io.SeekStart); err != nil {
				return nil, err
			}
		}
		var input io.Reader
		if body != nil {
			// Do not let http.Client close the spool file before a retry.
			input = struct{ io.Reader }{body}
		}
		req, err := http.NewRequestWithContext(ctx, method, endpoint, input)
		if err != nil {
			return nil, errors.New("OneDrive backup: invalid request")
		}
		if body != nil {
			size, err := body.Seek(0, io.SeekEnd)
			if err != nil {
				return nil, err
			}
			if _, err := body.Seek(0, io.SeekStart); err != nil {
				return nil, err
			}
			req.ContentLength = size
		}
		req.Header = headers.Clone()
		if req.Header == nil {
			req.Header = make(http.Header)
		}
		if auth {
			session, err := sessionFrom(ctx)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Authorization", "Bearer "+session.token)
		}
		res, err := p.client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			// The operation may have committed. The caller retains unpublished objects
			// on uncertainty and retries through the normal backup protocol.
			return nil, errors.New("OneDrive backup: connection failed")
		}
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			return res, nil
		}
		status := res.StatusCode
		wait := retryAfter(res.Header.Get("Retry-After"))
		res.Body.Close()
		// A 5xx can arrive after a Graph write committed. Replaying its CAS
		// would turn that uncertainty into a false conflict and allow cleanup
		// to delete published data. Let the sync protocol reconcile instead.
		retryable := status == 429 || ((status == 503 || status == 504) && (!auth || method == "GET" || method == "HEAD"))
		if attempt == 2 || !retryable {
			return nil, &graphError{status, wait}
		}
		delay := time.Second * time.Duration(1<<attempt)
		if wait > 0 {
			delay = wait
		}
		if delay > 30*time.Second {
			return nil, &graphError{status, wait}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	panic("unreachable")
}

func (p *Provider) jsonRequest(ctx context.Context, method, endpoint string, input, output any) error {
	var body io.ReadSeeker
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	res, err := p.request(ctx, method, endpoint, body, http.Header{"Content-Type": {"application/json"}}, true)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if output != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(output)
	}
	return nil
}

type driveItem struct {
	ETag   string           `json:"eTag"`
	ID     string           `json:"id"`
	Size   int64            `json:"size"`
	Folder *json.RawMessage `json:"folder"`
}

// The delegated /me drive isolates Microsoft accounts. Keep a readable folder
// name without changing the account identity used in encrypted AAD.
func (p *Provider) folder(ctx context.Context, userID string) (string, error) {
	session, err := sessionFrom(ctx)
	if err != nil {
		return "", err
	}
	if session.folder != "" {
		if session.user != userID {
			return "", errors.New("OneDrive backup: account mismatch")
		}
		return session.folder, nil
	}
	var root driveItem
	if err := p.jsonRequest(ctx, "GET", p.base+"/me/drive/special/approot", nil, &root); err != nil {
		return "", err
	}
	if root.ID == "" || root.Folder == nil {
		return "", errors.New("OneDrive backup: invalid app folder")
	}
	const name = "backup"
	endpoint := p.base + "/me/drive/items/" + url.PathEscape(root.ID) + ":/" + name
	var folder driveItem
	err = p.jsonRequest(ctx, "GET", endpoint, nil, &folder)
	if statusIs(err, 404) {
		err = p.jsonRequest(ctx, "POST", p.base+"/me/drive/items/"+url.PathEscape(root.ID)+"/children", map[string]any{
			"name": name, "folder": map[string]any{}, "@microsoft.graph.conflictBehavior": "fail",
		}, &folder)
		if statusIs(err, 409) {
			err = p.jsonRequest(ctx, "GET", endpoint, nil, &folder)
		}
	}
	if err != nil {
		return "", err
	}
	if folder.ID == "" || folder.Folder == nil {
		return "", errors.New("OneDrive backup: invalid account folder")
	}
	session.folder, session.user = folder.ID, userID
	return folder.ID, nil
}

func (p *Provider) objectURL(ctx context.Context, userID, name string) (string, error) {
	if !objectName.MatchString(name) {
		return "", errors.New("OneDrive backup: invalid object name")
	}
	folder, err := p.folder(ctx, userID)
	if err != nil {
		return "", err
	}
	return p.base + "/me/drive/items/" + url.PathEscape(folder) + ":/" + url.PathEscape(name), nil
}
func (p *Provider) open(ctx context.Context, userID, name string) (io.ReadCloser, error) {
	endpoint, err := p.objectURL(ctx, userID, name)
	if err != nil {
		return nil, err
	}
	res, err := p.request(ctx, "GET", endpoint+":/content", nil, nil, true)
	if statusIs(err, 404) {
		return nil, store.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}
func (p *Provider) remove(ctx context.Context, userID, name string) error {
	endpoint, err := p.objectURL(ctx, userID, name)
	if err != nil {
		return err
	}
	err = p.jsonRequest(ctx, "DELETE", endpoint, nil, nil)
	if statusIs(err, 404) {
		return nil
	}
	return err
}

// Spooling encrypted input bounds memory and makes each upload fragment replayable.
// The temporary file is removed before the API request returns.
func (p *Provider) upload(ctx context.Context, userID, name string, r io.Reader) (string, int64, error) {
	f, err := os.CreateTemp(p.tempDir, "wingman-onedrive-*")
	if err != nil {
		return "", 0, err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	hasher := sha256.New()
	size, err := io.Copy(f, io.TeeReader(r, hasher))
	if err != nil {
		return "", 0, err
	}
	endpoint, err := p.objectURL(ctx, userID, name)
	if err != nil {
		return "", 0, err
	}
	if size <= uploadChunk {
		res, err := p.request(ctx, "PUT", endpoint+":/content", f, http.Header{"Content-Type": {"application/octet-stream"}}, true)
		if err != nil {
			return "", 0, err
		}
		res.Body.Close()
	} else {
		var session struct {
			URL string `json:"uploadUrl"`
		}
		if err := p.jsonRequest(ctx, "POST", endpoint+":/createUploadSession", map[string]any{"item": map[string]string{"@microsoft.graph.conflictBehavior": "replace"}}, &session); err != nil {
			return "", 0, err
		}
		if !validUploadURL(session.URL) {
			return "", 0, errors.New("OneDrive backup: invalid upload session URL")
		}
		complete := false
		defer func() {
			if !complete {
				cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				defer cancel()
				if res, err := p.request(cleanup, "DELETE", session.URL, nil, nil, false); err == nil {
					res.Body.Close()
				}
			}
		}()
		buffer := make([]byte, uploadChunk)
		for offset := int64(0); offset < size; {
			length := min(int64(len(buffer)), size-offset)
			if _, err := f.ReadAt(buffer[:length], offset); err != nil {
				return "", 0, err
			}
			headers := http.Header{"Content-Type": {"application/octet-stream"}, "Content-Range": {fmt.Sprintf("bytes %d-%d/%d", offset, offset+length-1, size)}}
			res, err := p.request(ctx, "PUT", session.URL, bytes.NewReader(buffer[:length]), headers, false)
			if err != nil {
				return "", 0, err
			}
			status := res.StatusCode
			res.Body.Close()
			if (offset+length < size && status != 202) || (offset+length == size && status != 200 && status != 201) {
				return "", 0, errors.New("OneDrive backup: unexpected upload response")
			}
			offset += length
		}
		complete = true
	}
	return fmt.Sprintf("%x", hasher.Sum(nil)), size, nil
}

func validUploadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, domain := range []string{"1drv.com", "sharepoint.com", "storage.live.com", "onedrive.com"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}
