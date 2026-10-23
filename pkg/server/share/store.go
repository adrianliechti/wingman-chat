// Package share publishes artifact workspaces as static web pages under
// /artifacts/{id}/. A share is an immutable folder on disk: the browser uploads
// the workspace as a zip, the server extracts it once and serves the files
// until the configured retention has passed.
package share

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	metadataFile = "share.json"
	filesDir     = "files"
	uploadPrefix = ".upload-"

	// Zip headers and directory records on top of the content limit.
	archiveSlack = 4 << 20
	maxFiles     = 10_000
)

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

var (
	ErrNotFound = errors.New("share not found")
	ErrTooLarge = errors.New("the workspace exceeds the share size limit")
)

// ArchiveError rejects an upload the client can fix; it is answered with 400.
type ArchiveError string

func (e ArchiveError) Error() string { return string(e) }

type Share struct {
	ID    string `json:"id"`
	Entry string `json:"entry"`
	// Title is the entry page's <title>, shown in the viewer's header.
	Title   string    `json:"title,omitempty"`
	Owner   string    `json:"owner,omitempty"`
	Files   int       `json:"files"`
	Size    int64     `json:"size"`
	Created time.Time `json:"created"`
}

type Store struct {
	dir       string
	retention time.Duration
	maxSize   int64
	now       func() time.Time
}

func NewStore(dir string, retention time.Duration, maxSize int64) *Store {
	return &Store{
		dir:       dir,
		retention: retention,
		maxSize:   maxSize,
		now:       time.Now,
	}
}

// ExpiresAt applies the current retention, so lowering it also shortens
// shares published before the change.
func (s *Store) ExpiresAt(share *Share) time.Time {
	return share.Created.Add(s.retention)
}

func (s *Store) expired(share *Share) bool {
	return !s.now().Before(s.ExpiresAt(share))
}

// Create stores a zipped workspace whose entry page is entry, a path inside
// the archive. The share only becomes visible once it is complete.
func (s *Store) Create(body io.Reader, entry, owner string) (*Share, error) {
	entry = strings.TrimPrefix(entry, "/")
	if !validName(entry) {
		return nil, ArchiveError("the entry page path is invalid")
	}

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}

	tmp, err := os.MkdirTemp(s.dir, uploadPrefix)
	if err != nil {
		return nil, err
	}
	// After the final rename there is nothing left to remove.
	defer os.RemoveAll(tmp)

	archive := filepath.Join(tmp, "upload.zip")
	if err := s.receive(body, archive); err != nil {
		return nil, err
	}

	files, size, err := s.extract(archive, filepath.Join(tmp, filesDir), entry)
	if err != nil {
		return nil, err
	}

	title := pageTitle(filepath.Join(tmp, filesDir, filepath.FromSlash(entry)))

	if err := os.Remove(archive); err != nil {
		return nil, err
	}

	share := &Share{
		ID:      newID(),
		Entry:   entry,
		Title:   title,
		Owner:   owner,
		Files:   files,
		Size:    size,
		Created: s.now().UTC(),
	}

	data, err := json.Marshal(share)
	if err != nil {
		return nil, err
	}

	if err := os.WriteFile(filepath.Join(tmp, metadataFile), data, 0o644); err != nil {
		return nil, err
	}

	if err := os.Rename(tmp, filepath.Join(s.dir, share.ID)); err != nil {
		return nil, err
	}

	return share, nil
}

func (s *Store) receive(body io.Reader, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	limit := s.maxSize + archiveSlack
	n, err := io.Copy(f, io.LimitReader(body, limit+1))
	if err != nil {
		return ArchiveError("the upload could not be read")
	}

	if n > limit {
		return ErrTooLarge
	}

	return f.Close()
}

// extract validates every entry before writing any of them: regular files
// with clean relative paths, within the file count and the size limit.
func (s *Store) extract(archive, dest, entry string) (int, int64, error) {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return 0, 0, ArchiveError("the upload is not a zip archive")
	}
	defer r.Close()

	var files []*zip.File
	var total uint64
	hasEntry := false

	for _, f := range r.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}

		if !validName(f.Name) {
			return 0, 0, ArchiveError(fmt.Sprintf("invalid path %q", f.Name))
		}

		if !f.Mode().IsRegular() {
			return 0, 0, ArchiveError(fmt.Sprintf("%s is not a regular file", f.Name))
		}

		// ZIP64 sizes are untrusted uint64s. Check the remaining budget before
		// adding, so a wrapped total cannot admit oversized files for extraction.
		if f.UncompressedSize64 > uint64(s.maxSize)-total {
			return 0, 0, ErrTooLarge
		}

		files = append(files, f)
		total += f.UncompressedSize64

		if f.Name == entry {
			hasEntry = true
		}
	}

	if len(files) > maxFiles {
		return 0, 0, ArchiveError(fmt.Sprintf("the workspace has more than %d files", maxFiles))
	}

	if !hasEntry {
		return 0, 0, ArchiveError(fmt.Sprintf("the entry page %s is not in the upload", entry))
	}

	for _, f := range files {
		if err := extractFile(f, filepath.Join(dest, filepath.FromSlash(f.Name))); err != nil {
			return 0, 0, err
		}
	}

	return len(files), int64(total), nil
}

func extractFile(f *zip.File, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return ArchiveError(fmt.Sprintf("%s conflicts with another path", f.Name))
	}

	// O_EXCL also rejects duplicate names.
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return ArchiveError(fmt.Sprintf("%s conflicts with another path", f.Name))
	}
	defer out.Close()

	in, err := f.Open()
	if err != nil {
		return ArchiveError(fmt.Sprintf("%s could not be read", f.Name))
	}
	defer in.Close()

	// The header's size was checked against the limit; never write past it.
	n, err := io.Copy(out, io.LimitReader(in, int64(f.UncompressedSize64)+1))
	if err != nil || n != int64(f.UncompressedSize64) {
		return ArchiveError(fmt.Sprintf("%s is corrupt", f.Name))
	}

	return out.Close()
}

// Get returns a live share and its files; expired and unknown shares are
// both ErrNotFound.
func (s *Store) Get(id string) (*Share, fs.FS, error) {
	share, err := s.read(id)
	if err != nil || s.expired(share) {
		return nil, nil, ErrNotFound
	}

	return share, os.DirFS(filepath.Join(s.dir, id, filesDir)), nil
}

func (s *Store) read(id string) (*Share, error) {
	if !idPattern.MatchString(id) {
		return nil, ErrNotFound
	}

	data, err := os.ReadFile(filepath.Join(s.dir, id, metadataFile))
	if err != nil {
		return nil, ErrNotFound
	}

	var share Share
	if err := json.Unmarshal(data, &share); err != nil {
		return nil, ErrNotFound
	}

	return &share, nil
}

// Sweep deletes expired or unreadable shares and uploads abandoned mid-way.
func (s *Store) Sweep() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}

	for _, e := range entries {
		name := e.Name()
		path := filepath.Join(s.dir, name)

		if strings.HasPrefix(name, uploadPrefix) {
			if info, err := e.Info(); err == nil && s.now().Sub(info.ModTime()) > time.Hour {
				os.RemoveAll(path)
			}
			continue
		}

		if !idPattern.MatchString(name) {
			continue
		}

		if share, err := s.read(name); err != nil || s.expired(share) {
			os.RemoveAll(path)
		}
	}
}

var titleTag = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)

// pageTitle reads a page's <title> from its first 256 KiB, whitespace collapsed.
func pageTitle(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	head, _ := io.ReadAll(io.LimitReader(f, 256<<10))

	m := titleTag.FindSubmatch(head)
	if m == nil {
		return ""
	}

	title := []rune(strings.Join(strings.Fields(html.UnescapeString(string(m[1]))), " "))
	if len(title) > 200 {
		title = append(title[:199], '…')
	}

	return string(title)
}

func validName(name string) bool {
	return name != "." && fs.ValidPath(name) && !strings.ContainsAny(name, "\\\x00")
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
