package drive

import (
	"context"
	"io"
)

type Entry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
	Mime string `json:"mime,omitempty"`
}

type Provider interface {
	List(ctx context.Context, id string) ([]Entry, error)
	Open(ctx context.Context, id string) (io.ReadCloser, string, int64, error)
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
