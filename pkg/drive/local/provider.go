package local

import (
	"context"
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
var _ drive.InsightsProvider = (*Provider)(nil)

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

func (p *Provider) resolve(path string) (string, error) {
	if path == "" {
		return p.root, nil
	}

	cleaned := filepath.Clean(path)
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

func (p *Provider) List(_ context.Context, path string) ([]drive.Entry, error) {
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

		entry := drive.Entry{
			Name: e.Name(),
			Path: filepath.Join(path, e.Name()),
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

func (p *Provider) Insights(_ context.Context) ([]drive.InsightCategory, error) {
	type fileInfo struct {
		entry   drive.Entry
		modTime int64
	}

	var files []fileInfo

	filepath.Walk(p.root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		rel, err := filepath.Rel(p.root, path)
		if err != nil {
			return nil
		}

		files = append(files, fileInfo{
			entry: drive.Entry{
				Name: info.Name(),
				Path: rel,
				Kind: "file",
				Size: info.Size(),
				Mime: detectMime(info.Name()),
			},
			modTime: info.ModTime().Unix(),
		})

		return nil
	})

	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime > files[j].modTime
	})

	limit := 10
	if len(files) < limit {
		limit = len(files)
	}

	entries := make([]drive.Entry, limit)
	for i := 0; i < limit; i++ {
		entries[i] = files[i].entry
	}

	if len(entries) == 0 {
		return nil, nil
	}

	return []drive.InsightCategory{
		{
			Label:   "Recently Changed",
			Entries: entries,
		},
	}, nil
}

func detectMime(name string) string {
	ext := filepath.Ext(name)
	if ext == "" {
		return ""
	}

	return mime.TypeByExtension(ext)
}
