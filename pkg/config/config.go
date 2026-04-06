package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Load builds a Config by reading YAML files and applying environment variable overrides.
func Load() *Config {
	cfg := &Config{
		Title:      envOrDefault("TITLE", "Wingman AI"),
		Disclaimer: os.Getenv("DISCLAIMER"),
	}

	if u, e := os.Getenv("SUPPORT_URL"), os.Getenv("SUPPORT_EMAIL"); u != "" || e != "" {
		cfg.Support = &Support{URL: u, Email: e}
	}

	if bridgeURL := os.Getenv("BRIDGE_URL"); bridgeURL != "" {
		cfg.Bridge = &Bridge{URL: bridgeURL}
	}

	loadConfigFiles(cfg)
	applyEnvOverrides(cfg)

	return cfg
}

func loadConfigFiles(cfg *Config) {
	loadYAML("tools.yaml", &cfg.Tools)
	loadYAML("models.yaml", &cfg.Models)
	loadYAML("backgrounds.yaml", &cfg.Backgrounds)

	loadYAMLPtr("translator.yaml", &cfg.Translator)
	loadYAMLPtr("vision.yaml", &cfg.Vision)
	loadYAMLPtr("text.yaml", &cfg.Text)
	loadYAMLPtr("extractor.yaml", &cfg.Extractor)
	loadYAMLPtr("internet.yaml", &cfg.Internet)
	loadYAMLPtr("renderer.yaml", &cfg.Renderer)
	loadYAMLPtr("repository.yaml", &cfg.Repository)
}

func applyEnvOverrides(cfg *Config) {
	withFeature("TTS_ENABLED", &cfg.TTS, func(t *TTS) {
		envOverride("TTS_MODEL", &t.Model)
	})

	withFeature("STT_ENABLED", &cfg.STT, func(t *STT) {
		envOverride("STT_MODEL", &t.Model)
	})

	withFeature("VOICE_ENABLED", &cfg.Voice, func(v *Voice) {
		envOverride("VOICE_MODEL", &v.Model)
		envOverride("VOICE_TRANSCRIBER", &v.Transcriber)
	})

	withFeature("VISION_ENABLED", &cfg.Vision, nil)

	withFeature("INTERNET_ENABLED", &cfg.Internet, func(i *Internet) {
		envOverride("INTERNET_SCRAPER", &i.Scraper)
		envOverride("INTERNET_SEARCHER", &i.Searcher)
		envOverride("INTERNET_RESEARCHER", &i.Researcher)
		if envBool("INTERNET_ELICITATION") {
			i.Elicitation = true
		}
	})

	withFeature("RENDERER_ENABLED", &cfg.Renderer, func(r *Renderer) {
		envOverride("RENDERER_MODEL", &r.Model)
		envOverride("RENDERER_DISCLAIMER", &r.Disclaimer)
		if envBool("RENDERER_ELICITATION") {
			r.Elicitation = true
		}
	})

	withFeature("ARTIFACTS_ENABLED", &cfg.Artifacts, nil)

	withFeature("REPOSITORY_ENABLED", &cfg.Repository, func(r *Repository) {
		envOverride("REPOSITORY_EMBEDDER", &r.Embedder)
		envOverride("REPOSITORY_EXTRACTOR", &r.Extractor)
	})

	withFeature("MEMORY_ENABLED", &cfg.Memory, nil)

	withFeature("NOTEBOOK_ENABLED", &cfg.Notebook, func(n *Notebook) {
		envOverride("NOTEBOOK_MODEL", &n.Model)
	})

	withFeature("WORKFLOW_ENABLED", &cfg.Workflow, func(w *Workflow) {
		envOverride("WORKFLOW_MODEL", &w.Model)
	})

	withFeature("EXTRACTOR_ENABLED", &cfg.Extractor, func(e *Extractor) {
		envOverride("EXTRACTOR_MODEL", &e.Model)
	})

	if days := envPositiveInt("CHAT_RETENTION_DAYS", nil); days != nil {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.RetentionDays = days
	}

	if v := os.Getenv("CHAT_SUMMARIZER"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Summarizer = v
	}

	if v := os.Getenv("CHAT_OPTIMIZER"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Optimizer = v
	}

	withFeature("TELEMETRY_ENABLED", &cfg.Telemetry, nil)
}

// PlatformToken returns the API token from environment variables.
func PlatformToken() string {
	for _, key := range []string{"WINGMAN_TOKEN", "OPENAI_API_KEY"} {
		if val := os.Getenv(key); val != "" {
			return val
		}
	}

	return ""
}

// PlatformURL returns the platform API base URL from environment variables.
func PlatformURL() *url.URL {
	if u := urlFromEnv("WINGMAN_URL", "OPENAI_BASE_URL"); u != nil {
		return u
	}

	panic("WINGMAN_URL is not set or invalid")
}

// helpers

func envBool(key string) bool {
	return os.Getenv(key) == "true"
}

func envOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func envOverride(key string, target *string) {
	if val := os.Getenv(key); val != "" {
		*target = val
	}
}

func envPositiveInt(key string, fallback *int) *int {
	if s := os.Getenv(key); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return &n
		}
	}

	return fallback
}

// withFeature enables a feature if the env var is "true", ensures the pointer
// is non-nil, and calls configure with the guaranteed non-nil value.
func withFeature[T any](key string, target **T, configure func(*T)) {
	if !envBool(key) {
		return
	}

	*target = ensurePtr(*target)

	if configure != nil {
		configure(*target)
	}
}

func ensurePtr[T any](p *T) *T {
	if p == nil {
		p = new(T)
	}
	return p
}

func loadYAML[T any](filename string, target *T) {
	if data, err := os.ReadFile(filename); err == nil {
		yaml.Unmarshal(data, target)
	}
}

func loadYAMLPtr[T any](filename string, target **T) {
	if data, err := os.ReadFile(filename); err == nil {
		*target = new(T)
		yaml.Unmarshal(data, *target)
	}
}

func urlFromEnv(keys ...string) *url.URL {
	for _, key := range keys {
		if val, ok := os.LookupEnv(key); ok {
			if u := parseBaseURL(val); u != nil {
				return u
			}
		}
	}

	return nil
}

func parseBaseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil
	}

	u.Path = strings.TrimRight(u.Path, "/")
	u.Path = strings.TrimSuffix(u.Path, "/v1")
	u.Path = strings.TrimRight(u.Path, "/")

	return u
}
