//go:build linux || darwin

package file

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Lock stable sidecars, never files replaced by rename. Do not unlink sidecars:
// another pod may still hold their inode. The volume must support remote flock.
func (p *Provider) lock(ctx context.Context, key string) (func(), error) {
	return p.lockMode(ctx, key, true)
}

func (p *Provider) lockMode(ctx context.Context, key string, exclusive bool) (func(), error) {
	digest := sha256.Sum256([]byte(key))
	path := filepath.Join(p.root, ".locks", hex.EncodeToString(digest[:])+".lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	mode := syscall.LOCK_SH
	if exclusive {
		mode = syscall.LOCK_EX
	}
	for {
		if err := ctx.Err(); err != nil {
			f.Close()
			return nil, err
		}
		err = syscall.Flock(int(f.Fd()), mode|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
		}
		if errors.Is(err, syscall.EINTR) {
			continue
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			f.Close()
			return nil, err
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			f.Close()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
