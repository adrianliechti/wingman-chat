package drive

import "io"

type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
	Mime string `json:"mime,omitempty"`
}

type Provider interface {
	List(path string) ([]Entry, error)
	Open(path string) (io.ReadCloser, string, int64, error)
}
