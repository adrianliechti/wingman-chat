package file

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestBackupSize(t *testing.T) {
	p := newFileProvider(t)
	ctx := context.Background()
	if size, err := p.BackupSize(ctx, "missing"); err != nil || size != 0 {
		t.Fatalf("empty: %d, %v", size, err)
	}
	dir := p.userDir("alice")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"keystore.json": "123", "upload.tmp": "ignored"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if size, err := p.BackupSize(ctx, "alice"); err != nil || size != 3 {
		t.Fatalf("stored bytes: %d, %v", size, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := p.BackupSize(cancelled, "alice"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
}
