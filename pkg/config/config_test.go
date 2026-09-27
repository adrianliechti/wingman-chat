package config

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestCustomMCPEnabled(t *testing.T) {
	for _, value := range []string{"", "true", "false", "invalid"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("CUSTOM_MCP_ENABLED", value)
			cfg := Load()
			data, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			var served map[string]any
			if err := json.Unmarshal(data, &served); err != nil {
				t.Fatal(err)
			}
			got, present := served["enableCustomMCP"]
			switch value {
			case "true", "false":
				if !present || got != (value == "true") {
					t.Errorf("enableCustomMCP = %v, present = %v, want %s", got, present, value)
				}
			default:
				if present {
					t.Errorf("enableCustomMCP = %v, want omitted for default behavior", got)
				}
			}
		})
	}
}

func TestSpeechOverridesWithoutFeatureFlags(t *testing.T) {
	for _, key := range []string{"TTS_ENABLED", "STT_ENABLED", "VOICE_ENABLED"} {
		t.Setenv(key, "")
	}
	for _, tt := range []struct {
		name string
		env  map[string]string
		want Config
	}{
		{name: "synthesis", env: map[string]string{"TTS_MODEL": "speaker"}, want: Config{TTS: &TTS{Model: "speaker"}}},
		{name: "dictation", env: map[string]string{"STT_MODEL": "dictation"}, want: Config{STT: &STT{Model: "dictation"}}},
		{name: "voice", env: map[string]string{"VOICE_MODEL": "conversation"}, want: Config{Voice: &Voice{Model: "conversation"}}},
		{name: "live transcription", env: map[string]string{"VOICE_TRANSCRIBER": "live-transcription"}, want: Config{Voice: &Voice{Transcriber: "live-transcription"}}},
		{name: "voice and transcription", env: map[string]string{"VOICE_MODEL": "conversation", "VOICE_TRANSCRIBER": "live-transcription"}, want: Config{Voice: &Voice{Model: "conversation", Transcriber: "live-transcription"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, key := range []string{"TTS_MODEL", "STT_MODEL", "VOICE_MODEL", "VOICE_TRANSCRIBER"} {
				t.Setenv(key, tt.env[key])
			}
			cfg := Load()
			if !reflect.DeepEqual(cfg.TTS, tt.want.TTS) || !reflect.DeepEqual(cfg.STT, tt.want.STT) || !reflect.DeepEqual(cfg.Voice, tt.want.Voice) {
				t.Errorf("speech overrides = %#v, %#v, %#v; want %#v, %#v, %#v", cfg.TTS, cfg.STT, cfg.Voice, tt.want.TTS, tt.want.STT, tt.want.Voice)
			}
		})
	}
}

func TestModelFeatureEnableFlagsAreIgnored(t *testing.T) {
	for _, key := range []string{"TTS_MODEL", "STT_MODEL", "VOICE_MODEL", "VOICE_TRANSCRIBER", "RENDERER_MODEL"} {
		t.Setenv(key, "")
	}
	for _, key := range []string{"TTS_ENABLED", "STT_ENABLED", "VOICE_ENABLED", "RENDERER_ENABLED", "VISION_ENABLED"} {
		t.Setenv(key, "true")
	}
	cfg := Load()
	if cfg.TTS != nil || cfg.STT != nil || cfg.Voice != nil || cfg.Renderer != nil || cfg.Vision != nil {
		t.Fatal("legacy enable flags must not create feature config")
	}
}

func TestRendererOverrides(t *testing.T) {
	t.Setenv("RENDERER_ENABLED", "")
	for _, tt := range []struct {
		name, model string
		want        Renderer
	}{
		{name: "preserve YAML", want: Renderer{Model: "yaml-model"}},
		{name: "override model without enable flag", model: "env-model", want: Renderer{Model: "env-model"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("RENDERER_MODEL", tt.model)
			path := t.TempDir() + "/renderer.yaml"
			if err := os.WriteFile(path, []byte("model: yaml-model\n"), 0600); err != nil {
				t.Fatal(err)
			}
			var cfg Config
			loadYAMLPtr(path, &cfg.Renderer)
			applyEnvOverrides(&cfg)
			if cfg.Renderer == nil || *cfg.Renderer != tt.want {
				t.Errorf("renderer = %#v, want %#v", cfg.Renderer, tt.want)
			}
		})
	}

	t.Run("environment only", func(t *testing.T) {
		t.Setenv("RENDERER_MODEL", "env-model")
		var cfg Config
		applyEnvOverrides(&cfg)
		if cfg.Renderer == nil || *cfg.Renderer != (Renderer{Model: "env-model"}) {
			t.Errorf("renderer = %#v", cfg.Renderer)
		}
	})
}

func TestModelCapabilitiesReachFrontend(t *testing.T) {
	path := t.TempDir() + "/models.yaml"
	if err := os.WriteFile(path, []byte("- id: opaque\n  type: synthesizer\n- id: reader\n  supportsVision: true\n- id: gpt-4.1\n  supportsVision: false\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	loadYAML(path, &cfg.Models)
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"models":[{"id":"opaque","type":"synthesizer"},{"id":"reader","supportsVision":true},{"id":"gpt-4.1","supportsVision":false}]}` {
		t.Errorf("config = %s", data)
	}
}

func TestLoadAccountLinks(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatal(err)
		}
	})

	tests := []struct {
		name string
		yaml string
		want Config
	}{
		{
			name: "arbitrary links retain their order and metadata",
			yaml: `
- title: Docs
  url: https://example.com/docs
  icon: docs
- title: Community
  description: Talk to the team
  url: https://example.com/community
  icon: community
- url: https://example.com/other
`,
			want: Config{Links: []Link{
				{Title: "Docs", URL: "https://example.com/docs", Icon: "docs"},
				{Title: "Community", Description: "Talk to the team", URL: "https://example.com/community", Icon: "community"},
				{URL: "https://example.com/other"},
			}},
		},
		{
			name: "existing deployments retain support and cost",
			yaml: `
support:
  title: Learning Hub
  description: Guides to get started
  url: https://example.com/support
cost:
  url: https://example.com/cost
`,
			want: Config{
				Support: &Link{Title: "Learning Hub", Description: "Guides to get started", URL: "https://example.com/support"},
				Cost:    &Link{URL: "https://example.com/cost"},
			},
		},
		{name: "empty list", yaml: "[]", want: Config{Links: []Link{}}},
		{name: "invalid YAML does not expose partial links", yaml: "- url: https://example.com\n  icon: [", want: Config{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := os.WriteFile("links.yaml", []byte(tt.yaml), 0600); err != nil {
				t.Fatal(err)
			}
			var cfg Config
			loadLinks(&cfg)
			if !reflect.DeepEqual(cfg, tt.want) {
				t.Errorf("config = %#v, want %#v", cfg, tt.want)
			}
		})
	}
}
