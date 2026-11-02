//go:build !linux && !darwin

package file

import (
	"context"
	"fmt"
)

func (p *Provider) lock(ctx context.Context, key string) (func(), error) {
	return p.lockMode(ctx, key, true)
}

func (p *Provider) lockMode(ctx context.Context, key string, exclusive bool) (func(), error) {
	return nil, fmt.Errorf("file store requires Linux or macOS file locking")
}
