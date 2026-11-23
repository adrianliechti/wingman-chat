package onedrive

import (
	"strings"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func TestOrphanSweepKeepsPublishedAndRecentObjects(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.PutObject(testSession(), store.FileObject, "workspace-file", strings.NewReader("file"), "*"); err != nil {
		t.Fatal(err)
	}
	if _, err := appendEvents(p, testSession(), "chat-1234", 0, []string{"event"}, [][]byte{[]byte("frame")}); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * orphanAge)
	graph.Mu.Lock()
	var folder string
	for name, files := range graph.Folders {
		if _, ok := files[indexName]; ok {
			folder = name
		}
	}
	graph.Modified = map[string]time.Time{}
	for name := range graph.Folders[folder] {
		graph.Modified[folder+"!"+name] = old
	}
	orphan, recent := newObject(), newObject()
	graph.Folders[folder][orphan] = []byte("abandoned")
	graph.Folders[folder][recent] = []byte("in flight")
	graph.Modified[folder+"!"+orphan] = old
	graph.Mu.Unlock()
	exists := func(name string) bool {
		graph.Mu.Lock()
		defer graph.Mu.Unlock()
		_, ok := graph.Folders[folder][name]
		return ok
	}

	if n, err := p.collectOrphans(testSession()); err != nil || n != 1 {
		t.Fatalf("collected %d, %v", n, err)
	}
	if exists(orphan) || !exists(recent) {
		t.Fatal("sweep must remove only old unreferenced objects")
	}
	if _, _, err := p.GetObject(testSession(), store.FileObject, "workspace-file"); err != nil {
		t.Fatalf("published file removed: %v", err)
	}
	if r, err := p.ReadEvents(testSession(), "chat-1234", 0); err != nil {
		t.Fatalf("published chat removed: %v", err)
	} else {
		r.Close()
	}

	another := newObject()
	graph.Mu.Lock()
	graph.Folders[folder][another] = []byte("abandoned")
	graph.Modified[folder+"!"+another] = old
	graph.Mu.Unlock()
	p.sweepInterval = time.Hour
	ctx := testSession()
	if _, err := p.load(ctx); err != nil {
		t.Fatal(err)
	}
	if !p.sweepOrphans(ctx) || p.sweepOrphans(ctx) {
		t.Fatal("sweep should start once per account and interval")
	}
	for deadline := time.Now().Add(5 * time.Second); exists(another); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("background sweep did not remove the orphan")
		}
	}
}

func TestOrphanSweepSkipsMissingIndex(t *testing.T) {
	p, graph := newTestProvider(t)
	if _, err := p.folder(testSession()); err != nil {
		t.Fatal(err)
	}
	orphan := newObject()
	graph.Mu.Lock()
	for name := range graph.Folders {
		graph.Folders[name][orphan] = []byte("data")
		graph.Modified = map[string]time.Time{name + "!" + orphan: time.Now().Add(-2 * orphanAge)}
	}
	graph.Mu.Unlock()
	if n, err := p.collectOrphans(testSession()); err != nil || n != 0 {
		t.Fatalf("swept without an index: %d, %v", n, err)
	}
}
