package config

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestModelFeatureSchema(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/models.yaml", []byte("- id: opaque\n  type: synthesizer\n- id: vision\n  supportsVision: true\n- id: text\n  supportsVision: false\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/vision.yaml", []byte("model: reader\nfiles: [image/png]\nmaxFileSize: 1000\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	loadYAML(dir+"/models.yaml", &cfg.Models)
	loadYAMLPtr(dir+"/vision.yaml", &cfg.Vision)
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"models":[{"type":"synthesizer","id":"opaque"},{"supportsVision":true,"id":"vision"},{"supportsVision":false,"id":"text"}],"vision":{"model":"reader","maxFileSize":1000,"files":["image/png"]}}`
	var gotJSON, wantJSON any
	if err := json.Unmarshal(data, &gotJSON); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &wantJSON); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotJSON, wantJSON) {
		t.Fatalf("browser configuration = %s, want %s", data, want)
	}
}

func TestModelFeatureOverridesWithoutEnableFlags(t *testing.T) {
	for _, key := range []string{"TTS_ENABLED", "STT_ENABLED", "VOICE_ENABLED", "VISION_ENABLED", "RENDERER_ENABLED"} {
		t.Setenv(key, "")
	}
	t.Setenv("TTS_MODEL", "speaker")
	t.Setenv("STT_MODEL", "dictation")
	t.Setenv("VOICE_MODEL", "conversation")
	t.Setenv("VOICE_TRANSCRIBER", "live-transcription")
	t.Setenv("RENDERER_MODEL", "image")
	t.Setenv("RENDERER_DISCLAIMER", "")
	t.Setenv("RENDERER_ELICITATION", "")
	cfg := Config{TTS: &TTS{Voices: &map[string]string{"narrator": "custom"}}, Renderer: &Renderer{Disclaimer: "Keep this", Elicitation: true}}
	applyEnvOverrides(&cfg)
	if cfg.TTS.Model != "speaker" || (*cfg.TTS.Voices)["narrator"] != "custom" || cfg.STT.Model != "dictation" || cfg.Voice.Model != "conversation" || cfg.Voice.Transcriber != "live-transcription" {
		t.Fatal("speech defaults were not preserved")
	}
	if *cfg.Renderer != (Renderer{Model: "image", Disclaimer: "Keep this", Elicitation: true}) {
		t.Fatalf("renderer defaults = %#v", cfg.Renderer)
	}
}

func TestModelFeatureFlagsAreIgnored(t *testing.T) {
	for _, key := range []string{"TTS_MODEL", "STT_MODEL", "VOICE_MODEL", "VOICE_TRANSCRIBER", "RENDERER_MODEL", "RENDERER_DISCLAIMER", "RENDERER_ELICITATION"} {
		t.Setenv(key, "")
	}
	for _, value := range []string{"true", "false"} {
		t.Run(value, func(t *testing.T) {
			for _, key := range []string{"TTS_ENABLED", "STT_ENABLED", "VOICE_ENABLED", "VISION_ENABLED", "RENDERER_ENABLED"} {
				t.Setenv(key, value)
			}
			var cfg Config
			applyEnvOverrides(&cfg)
			if cfg.TTS != nil || cfg.STT != nil || cfg.Voice != nil || cfg.Vision != nil || cfg.Renderer != nil {
				t.Fatal("legacy flags created model configuration")
			}
		})
	}
}

func TestEmptyAndZeroConfigurationOverridesReachBrowser(t *testing.T) {
	path := t.TempDir() + "/config.yaml"
	data := []byte(`models:
  - id: chat
    supportedEfforts: []
    compactThreshold: 0
  - id: image
    supportedQualities: []
    supportedAspectRatios: ["16:9"]
    supportedResolutions: ["4K"]
    supportedBackgrounds: []
vision:
  files: []
tts:
  voices: {}
stt:
  format: wav
extractor:
  maxFileSize: 100
artifacts:
  maxFileSize: 200
translator:
  maxFileSize: 300
  maxTextLength: 400
  languages: []
  providers:
    - id: custom
      files: []
      languages: []
chat:
  compaction:
    threshold: 0
  classification:
    threshold: 0
  categories:
    - id: example
      threshold: 0
  risks:
    - id: example
      threshold: 0
`)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	loadYAML(path, &cfg)
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"models":[{"id":"chat","supportedEfforts":[],"compactThreshold":0},{"id":"image","supportedQualities":[],"supportedAspectRatios":["16:9"],"supportedResolutions":["4K"],"supportedBackgrounds":[]}],"vision":{"files":[]},"tts":{"voices":{}},"stt":{"format":"wav"},"extractor":{"maxFileSize":100},"artifacts":{"maxFileSize":200},"translator":{"maxFileSize":300,"maxTextLength":400,"languages":[],"providers":[{"id":"custom","files":[],"languages":[]}]},"chat":{"compaction":{"threshold":0},"classification":{"threshold":0},"categories":[{"id":"example","threshold":0}],"risks":[{"id":"example","threshold":0}]}}`), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("configuration lost an override: %s", encoded)
	}
}

func TestConfiguredFeaturesAcceptEnvironmentOverrides(t *testing.T) {
	t.Setenv("TRANSLATOR_ENABLED", "")
	t.Setenv("TRANSLATOR_MODEL", "new-translator")
	t.Setenv("REPOSITORY_ENABLED", "")
	t.Setenv("REPOSITORY_EMBEDDER", "new-embedder")
	t.Setenv("CHAT_COMPACTION_THRESHOLD", "0")
	cfg := Config{Translator: &Translator{Model: "old"}, Repository: &Repository{Embedder: "old"}}
	applyEnvOverrides(&cfg)
	if cfg.Translator.Model != "new-translator" || cfg.Repository.Embedder != "new-embedder" {
		t.Fatal("environment overrides required redundant enable flags")
	}
	if cfg.Chat == nil || cfg.Chat.Compaction == nil || cfg.Chat.Compaction.Threshold == nil || *cfg.Chat.Compaction.Threshold != 0 {
		t.Fatal("zero must disable compaction")
	}
}

func TestStandalonePagesRequireExplicitEnableFlags(t *testing.T) {
	for _, value := range []string{"", "false", "true"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("CANVAS_ENABLED", value)
			t.Setenv("TRANSLATOR_ENABLED", value)
			cfg := Config{Renderer: &Renderer{Model: "image"}, Translator: &Translator{Model: "chat"}}
			applyEnvOverrides(&cfg)
			if cfg.CanvasEnabled != (value == "true") || cfg.TranslatorEnabled != (value == "true") {
				t.Fatal("page visibility did not follow explicit flags")
			}
			if cfg.Renderer == nil || cfg.Translator == nil {
				t.Fatal("page flags must preserve helper defaults")
			}
		})
	}
}

func TestSpeechYAMLDefaults(t *testing.T) {
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
	for path, value := range map[string]string{
		"tts.yaml":   "model: speaker\nvoices:\n  narrator: custom\n",
		"stt.yaml":   "model: dictation\nformat: wav\n",
		"voice.yaml": "model: conversation\ntranscriber: live\n",
	} {
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var cfg Config
	loadConfigFiles(&cfg)
	if cfg.TTS == nil || cfg.TTS.Model != "speaker" || cfg.TTS.Voices == nil || (*cfg.TTS.Voices)["narrator"] != "custom" || cfg.STT == nil || cfg.STT.Format != "wav" || cfg.Voice == nil || cfg.Voice.Transcriber != "live" {
		t.Fatalf("speech YAML not loaded: %#v", cfg)
	}
}
