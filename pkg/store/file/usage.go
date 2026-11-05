package file

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// BackupSize measures stored bytes without reading encrypted contents. Concurrent
// uploads may change the result; temporary files and filesystem overhead are omitted.
func (p *Provider) BackupSize(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := filepath.WalkDir(p.userDir(userID), func(path string, entry fs.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.IsDir() || strings.HasSuffix(entry.Name(), ".tmp") {
			return nil
		}
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total, err
}
