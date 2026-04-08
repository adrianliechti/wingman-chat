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

type InsightCategory struct {
	Label   string  `json:"label"`
	Entries []Entry `json:"entries"`
}

// InsightsProvider is an optional interface that providers can implement
// to surface suggested/interesting files grouped by category.
type InsightsProvider interface {
	Insights(ctx context.Context) ([]InsightCategory, error)
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
