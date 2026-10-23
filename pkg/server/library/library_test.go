package library

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSkillsInventoryAndContent(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, "data", "analyze")
	mustMkdirAll(t, filepath.Join(skillDir, "references"))
	mustWriteFile(t, filepath.Join(skillDir, "SKILL.md"), `---
name: analyze
description: Analyze data
compatibility: Browser
---
# Analyze
`)
	mustWriteFile(t, filepath.Join(skillDir, "references", "guide.md"), "# Guide\n")
	mustWriteFile(t, filepath.Join(skillDir, ".DS_Store"), "ignored")

	mux := http.NewServeMux()
	NewSkills(root).Attach(mux)

	inventoryResponse := httptest.NewRecorder()
	mux.ServeHTTP(inventoryResponse, httptest.NewRequest(http.MethodGet, "/skills", nil))
	if inventoryResponse.Code != http.StatusOK {
		t.Fatalf("GET /skills status = %d, want %d", inventoryResponse.Code, http.StatusOK)
	}

	var entries []skillEntry
	if err := json.NewDecoder(inventoryResponse.Body).Decode(&entries); err != nil {
		t.Fatalf("decode inventory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("inventory length = %d, want 1", len(entries))
	}

	entry := entries[0]
	if entry.Name != "analyze" || entry.Description != "Analyze data" || entry.Compatibility != "Browser" {
		t.Fatalf("unexpected inventory metadata: %+v", entry)
	}
	if entry.Category != "data" || entry.Path != "/skills/data/analyze/SKILL.md" {
		t.Fatalf("unexpected inventory location: %+v", entry)
	}
	if want := []string{"references/guide.md"}; !reflect.DeepEqual(entry.Resources, want) {
		t.Fatalf("resources = %v, want %v", entry.Resources, want)
	}

	contentResponse := httptest.NewRecorder()
	mux.ServeHTTP(
		contentResponse,
		httptest.NewRequest(http.MethodGet, "/skills/data/analyze/SKILL.md", nil),
	)
	if contentResponse.Code != http.StatusOK {
		t.Fatalf("GET skill content status = %d, want %d", contentResponse.Code, http.StatusOK)
	}
	content, err := io.ReadAll(contentResponse.Body)
	if err != nil {
		t.Fatalf("read skill content: %v", err)
	}
	if got, want := string(content), `---
name: analyze
description: Analyze data
compatibility: Browser
---
# Analyze
`; got != want {
		t.Fatalf("skill content = %q, want %q", got, want)
	}
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("create directory %s: %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
