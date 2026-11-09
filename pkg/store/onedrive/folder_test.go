package onedrive

import (
	"context"
	"testing"
)

func TestBackupFolderName(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.folder(WithToken(context.Background(), "graph-token"), "alice"); err != nil {
		t.Fatal(err)
	}
	if len(graph.Folders) != 1 || graph.Folders["backup"] == nil {
		t.Fatalf("expected only backup folder, got %v", graph.Folders)
	}
}
