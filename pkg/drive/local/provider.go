package local

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
)

var _ drive.Provider = (*Provider)(nil)

type Provider struct {
	root string
}

func New(root string) (*Provider, error) {
	dir, err := filepath.Abs(root)

	if err != nil {
		return nil, err
	}

	p := &Provider{
		root: dir,
	}

	return p, nil
}

const idPrefix = "b64:"

func encodeID(path string) string {
	return idPrefix + base64.RawURLEncoding.EncodeToString([]byte(path))
}

func decodeID(id string) (string, bool) {
	encoded, ok := strings.CutPrefix(id, idPrefix)
	if !ok {
		return "", false
	}

	b, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}

	return string(b), true
}

func (p *Provider) resolve(path string) (string, error) {
	if path == "" || path == "/" {
		return p.root, nil
	}

	cleaned := filepath.Clean(strings.TrimPrefix(path, "/"))
	full := filepath.Join(p.root, cleaned)

	abs, err := filepath.Abs(full)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}

	if !strings.HasPrefix(abs, p.root+string(filepath.Separator)) && abs != p.root {
		return "", fmt.Errorf("path outside root: %s", path)
	}

	return abs, nil
}

func (p *Provider) List(_ context.Context, id string) ([]drive.Entry, error) {
	path := ""

	if decoded, ok := decodeID(id); ok {
		path = decoded
	} else if id != "" {
		path = id
	}

	resolved, err := p.resolve(path)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		iDir := entries[i].IsDir()
		jDir := entries[j].IsDir()

		if iDir != jDir {
			return iDir
		}

		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	result := make([]drive.Entry, 0, len(entries))

	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}

		rel := filepath.Join(path, e.Name())

		entry := drive.Entry{
			ID:   encodeID(rel),
			Name: e.Name(),
		}

		if e.IsDir() {
			entry.Kind = "directory"
		} else {
			entry.Kind = "file"

			if info, err := e.Info(); err == nil {
				entry.Size = info.Size()
			}

			entry.Mime = detectMime(e.Name())
		}

		result = append(result, entry)
	}

	return result, nil
}

func (p *Provider) Open(_ context.Context, path string) (io.ReadCloser, string, int64, error) {
	if decoded, ok := decodeID(path); ok {
		path = decoded
	}

	resolved, err := p.resolve(path)
	if err != nil {
		return nil, "", 0, err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return nil, "", 0, err
	}

	if info.IsDir() {
		return nil, "", 0, fmt.Errorf("path is a directory: %s", path)
	}

	f, err := os.Open(resolved)
	if err != nil {
		return nil, "", 0, err
	}

	mimeType := detectMime(resolved)

	if mimeType == "" {
		buf := make([]byte, 512)
		n, _ := f.Read(buf)
		mimeType = http.DetectContentType(buf[:n])
		f.Seek(0, io.SeekStart)
	}

	return f, mimeType, info.Size(), nil
}

func detectMime(name string) string {
	ext := filepath.Ext(name)
	if ext == "" {
		return ""
	}

	return mime.TypeByExtension(ext)
}
