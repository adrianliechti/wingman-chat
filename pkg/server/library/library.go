// Package library serves runtime inventories of the on-disk skill and notebook
// libraries. Each is a directory of markdown files with YAML frontmatter that
// the server walks on demand (cached) and exposes as JSON, so items can be added
// by dropping a folder into the mounted directory — no rebuild required.
package library

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// How long a built inventory is reused before the directory is re-walked.
const cacheTTL = 30 * time.Second

// splitDocument splits leading YAML frontmatter from the markdown body. When the
// file has no frontmatter, block is nil and body is the input unchanged.
func splitDocument(data []byte) (block, body []byte) {
	s := string(data)
	if !strings.HasPrefix(s, "---") {
		return nil, data
	}

	nl := strings.IndexByte(s, '\n')
	if nl < 0 {
		return nil, data
	}

	rest := s[nl+1:]

	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, data
	}

	after := rest[end+len("\n---"):]
	if i := strings.IndexByte(after, '\n'); i >= 0 {
		after = after[i+1:]
	}

	return []byte(rest[:end]), []byte(strings.TrimLeft(after, "\n"))
}

func parseFrontmatter(data []byte, out any) {
	if block, _ := splitDocument(data); block != nil {
		yaml.Unmarshal(block, out)
	}
}

// safePath resolves root/<rel>, returning the absolute file path and true only
// when it stays within root and points at an existing file.
func safePath(root, rel string) (string, bool) {
	full := filepath.Join(root, filepath.FromSlash(path.Clean("/"+rel)))

	rootAbs, _ := filepath.Abs(root)
	fullAbs, err := filepath.Abs(full)
	if err != nil || (fullAbs != rootAbs && !strings.HasPrefix(fullAbs, rootAbs+string(os.PathSeparator))) {
		return "", false
	}

	if info, err := os.Stat(fullAbs); err != nil || info.IsDir() {
		return "", false
	}

	return fullAbs, true
}

// titleize turns a kebab-case id into a display label ("sketch-note" → "Sketch Note").
func titleize(id string) string {
	words := strings.Split(id, "-")
	for i, w := range words {
		if w != "" {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// inventory is a TTL-cached JSON list rebuilt from disk by build.
type inventory[T any] struct {
	build func() []T

	mu    sync.Mutex
	cache []T
	built time.Time
}

func (inv *inventory[T]) serve(w http.ResponseWriter, _ *http.Request) {
	inv.mu.Lock()
	if inv.cache == nil || time.Since(inv.built) > cacheTTL {
		inv.cache = inv.build()
		inv.built = time.Now()
	}
	out := inv.cache
	inv.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// ── Skills ──────────────────────────────────────────────────────────────────

type skillEntry struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Path        string   `json:"path"`
	Resources   []string `json:"resources,omitempty"`
}

type Skills struct {
	root string
	inv  inventory[skillEntry]
}

func NewSkills(root string) *Skills {
	h := &Skills{root: root}
	h.inv.build = h.build
	return h
}

func (h *Skills) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /skills", h.inv.serve)
	mux.HandleFunc("GET /skills/{path...}", h.handleContent)
}

func (h *Skills) handleContent(w http.ResponseWriter, r *http.Request) {
	full, ok := safePath(h.root, r.PathValue("path"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Skills are served whole — the client parses the frontmatter for name/description.
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	http.ServeFile(w, r, full)
}

func (h *Skills) build() []skillEntry {
	entries := []skillEntry{}

	filepath.WalkDir(h.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() != "SKILL.md" {
			return nil
		}

		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}

		var meta struct {
			Name        string `yaml:"name"`
			Description string `yaml:"description"`
		}
		parseFrontmatter(data, &meta)

		if meta.Name == "" {
			return nil
		}

		rel, _ := filepath.Rel(h.root, p)
		rel = filepath.ToSlash(rel)

		// First path segment is the grouping category when the skill is nested.
		category := ""
		if parts := strings.Split(rel, "/"); len(parts) > 2 {
			category = parts[0]
		}

		entries = append(entries, skillEntry{
			Name:        meta.Name,
			Description: meta.Description,
			Category:    category,
			Path:        "/skills/" + rel,
			Resources:   skillResources(filepath.Dir(p)),
		})

		return nil
	})

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Category != entries[j].Category {
			return entries[i].Category < entries[j].Category
		}
		return entries[i].Name < entries[j].Name
	})

	return entries
}

// skillResourceExtensions limits the bundled-resource listing to text files the
// client can fetch and read inline (read_skill_resource returns text). The skills
// tree is curated, shipped content, so — like the SKILL.md scan in build — we
// don't otherwise filter it.
var skillResourceExtensions = map[string]bool{
	".css":  true,
	".csv":  true,
	".html": true,
	".js":   true,
	".json": true,
	".md":   true,
	".mjs":  true,
	".py":   true,
	".sql":  true,
	".ts":   true,
	".txt":  true,
	".xml":  true,
	".yaml": true,
	".yml":  true,
}

// skillResources lists a skill's bundled support files as paths relative to the
// skill folder, so read_skill can surface them for on-demand loading.
func skillResources(skillDir string) []string {
	resources := []string{}

	filepath.WalkDir(skillDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() == "SKILL.md" || !skillResourceExtensions[strings.ToLower(filepath.Ext(d.Name()))] {
			return nil
		}
		if rel, err := filepath.Rel(skillDir, p); err == nil {
			resources = append(resources, filepath.ToSlash(rel))
		}
		return nil
	})

	sort.Strings(resources)
	return resources
}

// ── Notebooks ───────────────────────────────────────────────────────────────

type notebookEntry struct {
	Type        string   `json:"type"`
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Description string   `json:"description,omitempty"`
	Voices      []string `json:"voices,omitempty"`
	Default     bool     `json:"default,omitempty"`
	Path        string   `json:"path"`
}

type Notebooks struct {
	root string
	inv  inventory[notebookEntry]
}

func NewNotebooks(root string) *Notebooks {
	h := &Notebooks{root: root}
	h.inv.build = h.build
	return h
}

func (h *Notebooks) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /notebooks", h.inv.serve)
	mux.HandleFunc("GET /notebooks/{path...}", h.handleContent)
}

func (h *Notebooks) handleContent(w http.ResponseWriter, r *http.Request) {
	full, ok := safePath(h.root, r.PathValue("path"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	data, err := os.ReadFile(full)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Notebook prompts are used verbatim, so strip the frontmatter from the body.
	_, body := splitDocument(data)
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write(body)
}

func (h *Notebooks) build() []notebookEntry {
	entries := []notebookEntry{}

	filepath.WalkDir(h.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}

		rel, _ := filepath.Rel(h.root, p)
		rel = filepath.ToSlash(rel)

		parts := strings.Split(rel, "/")
		if len(parts) < 2 {
			return nil // style files live under a <type>/ folder
		}

		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}

		var meta struct {
			Label       string   `yaml:"label"`
			Description string   `yaml:"description"`
			Voices      []string `yaml:"voices"`
			Default     bool     `yaml:"default"`
		}
		parseFrontmatter(data, &meta)

		id := strings.TrimSuffix(d.Name(), ".md")
		label := meta.Label
		if label == "" {
			label = titleize(id)
		}

		entries = append(entries, notebookEntry{
			Type:        parts[0],
			ID:          id,
			Label:       label,
			Description: meta.Description,
			Voices:      meta.Voices,
			Default:     meta.Default,
			Path:        "/notebooks/" + rel,
		})

		return nil
	})

	// Group by type; within a type the default style sorts first, then by label.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type != entries[j].Type {
			return entries[i].Type < entries[j].Type
		}
		if entries[i].Default != entries[j].Default {
			return entries[i].Default
		}
		return entries[i].Label < entries[j].Label
	})

	return entries
}
