package drive

import (
	"context"
	"io"
)

type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
	Mime string `json:"mime,omitempty"`
}

type Provider interface {
	List(ctx context.Context, path string) ([]Entry, error)
	Open(ctx context.Context, path string) (io.ReadCloser, string, int64, error)
}

type contextKey int

const tokenKey contextKey = iota

func WithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, tokenKey, token)
}

func TokenFromContext(ctx context.Context) string {
	if token, ok := ctx.Value(tokenKey).(string); ok {
		return token
	}

	return ""
}
