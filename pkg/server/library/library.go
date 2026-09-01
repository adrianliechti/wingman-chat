// Package library serves a runtime inventory of the on-disk skill library. The
// server walks the directory on demand (cached) and exposes it as JSON, so skills
// can be added by dropping a folder into the mounted directory without rebuilding.
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

func parseFrontmatter(data []byte, out any) {
	s := string(data)
	if !strings.HasPrefix(s, "---") {
		return
	}

	nl := strings.IndexByte(s, '\n')
	if nl < 0 {
		return
	}

	rest := s[nl+1:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return
	}

	yaml.Unmarshal([]byte(rest[:end]), out)
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

// ── Skills ──────────────────────────────────────────────────────────────────

type skillEntry struct {
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Category      string   `json:"category"`
	Path          string   `json:"path"`
	Compatibility string   `json:"compatibility,omitempty"`
	Resources     []string `json:"resources,omitempty"`
}

type Skills struct {
	root  string
	mu    sync.Mutex
	cache []skillEntry
	built time.Time
}

func NewSkills(root string) *Skills {
	return &Skills{root: root}
}

func (h *Skills) Attach(mux *http.ServeMux) {
	mux.HandleFunc("GET /skills", h.serveInventory)
	mux.HandleFunc("GET /skills/{path...}", h.handleContent)
}

func (h *Skills) serveInventory(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	if h.cache == nil || time.Since(h.built) > cacheTTL {
		h.cache = h.build()
		h.built = time.Now()
	}
	out := h.cache
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
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
			Name          string `yaml:"name"`
			Description   string `yaml:"description"`
			Compatibility string `yaml:"compatibility"`
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
			Name:          meta.Name,
			Description:   meta.Description,
			Category:      category,
			Path:          "/skills/" + rel,
			Compatibility: meta.Compatibility,
			Resources:     skillResources(filepath.Dir(p)),
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

// skillResources lists a skill's bundled support files as paths relative to the
// skill folder, so read_skill can surface them for on-demand loading. The skills
// tree is curated, shipped content, so — like the SKILL.md scan in build — we
// list everything except the SKILL.md itself and hidden files (e.g. .DS_Store).
// read_skill_resource returns text, so non-text assets shouldn't be bundled.
func skillResources(skillDir string) []string {
	resources := []string{}

	filepath.WalkDir(skillDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || d.Name() == "SKILL.md" {
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
