package file

import (
	"context"
	"os"
)

func (p *Provider) LockUser(ctx context.Context, userID string, exclusive bool) (func(), error) {
	// NUL cannot occur in an HTTP identity or chat ID, so this namespace
	// cannot collide with an existing resource lock.
	return p.lockMode(ctx, "user\x00"+userID, exclusive)
}

func (p *Provider) ResetUser(ctx context.Context, userID string) error {
	unlock, err := p.LockUser(ctx, userID, true)
	if err != nil {
		return err
	}
	defer unlock()
	// Lock sidecars live outside the user directory and must remain stable.
	return os.RemoveAll(p.userDir(userID))
}
