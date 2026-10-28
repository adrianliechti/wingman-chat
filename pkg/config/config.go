package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v4"
)

// Load builds a Config by reading YAML files and applying environment variable overrides.
func Load() *Config {
	cfg := &Config{
		Title:      envOrDefault("TITLE", "Wingman AI"),
		Disclaimer: os.Getenv("DISCLAIMER"),
	}

	if companionURL := os.Getenv("BRIDGE_URL"); companionURL != "" {
		cfg.Companion = &Companion{URL: companionURL}
	}

	if pluginsURL := os.Getenv("PLUGINS_URL"); pluginsURL != "" {
		if u, err := url.Parse(pluginsURL); err == nil {
			u.Fragment = ""
			if !strings.HasSuffix(u.Path, "/") {
				u.Path += "/"
			}
			cfg.Plugins = &Plugins{URL: u.String()}
		}
	}

	loadConfigFiles(cfg)
	applyEnvOverrides(cfg)

	return cfg
}

func loadConfigFiles(cfg *Config) {
	loadLinks(cfg)
	loadYAML("tools.yaml", &cfg.Tools)
	loadYAML("models.yaml", &cfg.Models)
	loadDrives(cfg)
	loadYAML("backgrounds.yaml", &cfg.Backgrounds)

	loadYAMLPtr("chat.yaml", &cfg.Chat)
	loadYAMLPtr("translator.yaml", &cfg.Translator)
	loadYAMLPtr("tts.yaml", &cfg.TTS)
	loadYAMLPtr("stt.yaml", &cfg.STT)
	loadYAMLPtr("voice.yaml", &cfg.Voice)
	loadYAMLPtr("vision.yaml", &cfg.Vision)
	loadYAMLPtr("text.yaml", &cfg.Text)
	loadYAMLPtr("extractor.yaml", &cfg.Extractor)
	loadYAMLPtr("renderer.yaml", &cfg.Renderer)
	loadYAMLPtr("repository.yaml", &cfg.Repository)
	loadYAMLPtr("artifacts.yaml", &cfg.Artifacts)
}

func loadDrives(cfg *Config) {
	loadYAML("drives.yaml", &cfg.Drives)

	for _, drive := range cfg.Drives {
		if auth := drive.Auth; auth != nil {
			// Expand after parsing to preserve quotes and newlines in secrets.
			auth.Issuer = os.ExpandEnv(auth.Issuer)
			auth.ClientID = os.ExpandEnv(auth.ClientID)
			auth.ClientSecret = os.ExpandEnv(auth.ClientSecret)
			auth.Scope = os.ExpandEnv(auth.Scope)
		}
	}
}

// loadLinks reads the ordered account-menu links from links.yaml. The old
// support/cost mapping remains supported for existing deployments.
func loadLinks(cfg *Config) {
	data, err := os.ReadFile("links.yaml")
	if err != nil {
		return
	}

	var links []Link
	if err := yaml.Load(data, &links); err == nil {
		cfg.Links = links
		return
	}

	var legacy struct {
		Support *Link `yaml:"support"`
		Cost    *Link `yaml:"cost"`
	}
	if err := yaml.Load(data, &legacy); err == nil {
		cfg.Support = legacy.Support
		cfg.Cost = legacy.Cost
	}
}

func applyEnvOverrides(cfg *Config) {
	// Model availability comes from the inventory; these settings only select defaults.
	if model := os.Getenv("TTS_MODEL"); model != "" {
		cfg.TTS = ensurePtr(cfg.TTS)
		cfg.TTS.Model = model
	}
	if model := os.Getenv("STT_MODEL"); model != "" {
		cfg.STT = ensurePtr(cfg.STT)
		cfg.STT.Model = model
	}
	if os.Getenv("VOICE_MODEL") != "" || os.Getenv("VOICE_TRANSCRIBER") != "" {
		cfg.Voice = ensurePtr(cfg.Voice)
		envOverride("VOICE_MODEL", &cfg.Voice.Model)
		envOverride("VOICE_TRANSCRIBER", &cfg.Voice.Transcriber)
	}
	if os.Getenv("RENDERER_MODEL") != "" || os.Getenv("RENDERER_DISCLAIMER") != "" || os.Getenv("RENDERER_ELICITATION") != "" {
		cfg.Renderer = ensurePtr(cfg.Renderer)
		envOverride("RENDERER_MODEL", &cfg.Renderer.Model)
		envOverride("RENDERER_DISCLAIMER", &cfg.Renderer.Disclaimer)
		if enabled, err := strconv.ParseBool(os.Getenv("RENDERER_ELICITATION")); err == nil {
			cfg.Renderer.Elicitation = enabled
		}
	}

	if model := os.Getenv("REPOSITORY_EMBEDDER"); model != "" {
		cfg.Repository = ensurePtr(cfg.Repository)
		cfg.Repository.Embedder = model
	}

	if model := os.Getenv("TRANSLATOR_MODEL"); model != "" {
		cfg.Translator = ensurePtr(cfg.Translator)
		cfg.Translator.Model = model
	}
	cfg.TranslatorEnabled = envBool("TRANSLATOR_ENABLED")
	cfg.CanvasEnabled = envBool("CANVAS_ENABLED")

	if days := envPositiveInt("CHAT_RETENTION_DAYS", nil); days != nil {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.RetentionDays = days
	}

	if v := os.Getenv("CHAT_INSTRUCTIONS"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Instructions = v
	}

	if v := os.Getenv("CHAT_SUMMARIZER"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Summarizer = v
	}

	if v := os.Getenv("CHAT_OPTIMIZER"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Optimizer = v
	}

	if v := os.Getenv("CHAT_MODEL"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Model = v
	}

	if v := os.Getenv("CHAT_EFFORT"); v != "" {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Effort = v
	}

	if envBool("CHAT_COMPACTION_ENABLED") {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Compaction = ensurePtr(cfg.Chat.Compaction)
	}

	if v := envNonNegativeInt("CHAT_COMPACTION_THRESHOLD"); v != nil {
		cfg.Chat = ensurePtr(cfg.Chat)
		cfg.Chat.Compaction = ensurePtr(cfg.Chat.Compaction)
		cfg.Chat.Compaction.Threshold = v
	}

	if envBool("TELEMETRY_ENABLED") {
		cfg.Telemetry = ensurePtr(cfg.Telemetry)
	}

	if cfg.Telemetry != nil {
		envOverride("TELEMETRY_NAME", &cfg.Telemetry.Name)
	}
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

func envNonNegativeInt(key string) *int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n >= 0 {
		return &n
	}
	return nil
}

func envPositiveInt(key string, fallback *int) *int {
	if s := os.Getenv(key); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return &n
		}
	}

	return fallback
}

func ensurePtr[T any](p *T) *T {
	if p == nil {
		p = new(T)
	}
	return p
}

func loadYAML[T any](filename string, target *T) {
	if data, err := os.ReadFile(filename); err == nil {
		yaml.Load(data, target)
	}
}

func loadYAMLPtr[T any](filename string, target **T) {
	if data, err := os.ReadFile(filename); err == nil {
		*target = new(T)
		yaml.Load(data, *target)
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
