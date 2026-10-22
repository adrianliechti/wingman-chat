package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestModelReplacementsReachBrowserConfig(t *testing.T) {
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
	if err := os.WriteFile("models.yaml", []byte(`
- id: current
  replaces:
    - legacy
    - older
`), 0600); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	loadConfigFiles(&cfg)
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var browser struct {
		Models []struct {
			ID       string   `json:"id"`
			Replaces []string `json:"replaces"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &browser); err != nil {
		t.Fatal(err)
	}
	if len(browser.Models) != 1 || browser.Models[0].ID != "current" ||
		!reflect.DeepEqual(browser.Models[0].Replaces, []string{"legacy", "older"}) {
		t.Fatalf("unexpected browser config: %s", data)
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

func TestMCPConfigReachesBrowser(t *testing.T) {
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
	t.Setenv("BRIDGE_URL", "http://localhost:4242/")
	if err := os.WriteFile("tools.yaml", []byte(`
- id: managed
- id: direct
  needsApproval: true
  url: https://mcp.example.test/api
  headers:
    X-Tenant: example
`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := Load()
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var browser struct {
		Tools  []Tool     `json:"tools"`
		Bridge *Companion `json:"bridge"`
	}
	if err := json.Unmarshal(data, &browser); err != nil {
		t.Fatal(err)
	}
	if len(browser.Tools) != 2 || browser.Tools[0].URL != "" || browser.Tools[1].Headers["X-Tenant"] != "example" || !browser.Tools[1].NeedsApproval {
		t.Fatalf("tools.yaml lost MCP fields: %s", data)
	}
	if browser.Bridge == nil || browser.Bridge.URL != "http://localhost:4242/" {
		t.Fatalf("BRIDGE_URL changed its browser configuration contract: %s", data)
	}
}

func TestChatClassificationIDsReachBrowser(t *testing.T) {
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
	if err := os.WriteFile("chat.yaml", []byte(`
categories:
  - id: writing
    name: Writing
risks:
  - id: hr_decision
    name: HR decision
`), 0600); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(Load())
	if err != nil {
		t.Fatal(err)
	}
	var browser struct {
		Chat struct {
			Categories []struct{ ID string } `json:"categories"`
			Risks      []struct{ ID string } `json:"risks"`
		} `json:"chat"`
	}
	if err := json.Unmarshal(data, &browser); err != nil {
		t.Fatal(err)
	}
	if len(browser.Chat.Categories) != 1 || browser.Chat.Categories[0].ID != "writing" || len(browser.Chat.Risks) != 1 || browser.Chat.Risks[0].ID != "hr_decision" {
		t.Fatalf("chat.yaml lost category or risk IDs: %s", data)
	}
}

func TestTelemetryNameReachesBrowserConfig(t *testing.T) {
	for _, test := range []struct {
		name, enabled, service string
		want                   *Telemetry
	}{
		{name: "default", enabled: "true", want: &Telemetry{}},
		{name: "override", enabled: "true", service: "acme-assistant", want: &Telemetry{Name: "acme-assistant"}},
		{name: "name alone does not enable", service: "acme-assistant"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("TELEMETRY_ENABLED", test.enabled)
			t.Setenv("TELEMETRY_NAME", test.service)

			var cfg Config
			applyEnvOverrides(&cfg)

			if !reflect.DeepEqual(cfg.Telemetry, test.want) {
				t.Fatalf("telemetry = %+v, want %+v", cfg.Telemetry, test.want)
			}
		})
	}
}

func TestArtifactsShareConfig(t *testing.T) {
	for _, test := range []struct {
		name, artifacts, share, path, days, size string
		want                                     *ArtifactsShare
	}{
		{name: "defaults", artifacts: "true", share: "true", want: &ArtifactsShare{Path: filepath.Join(os.TempDir(), "wingman-chat-shares"), RetentionDays: 7, MaxSize: 100 << 20}},
		{name: "overrides", artifacts: "true", share: "true", path: "/data/shares", days: "30", size: "1048576", want: &ArtifactsShare{Path: "/data/shares", RetentionDays: 30, MaxSize: 1 << 20}},
		{name: "requires artifacts", share: "true"},
		{name: "off by default", artifacts: "true", path: "/data/shares"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("ARTIFACTS_ENABLED", test.artifacts)
			t.Setenv("ARTIFACTS_SHARE_ENABLED", test.share)
			t.Setenv("ARTIFACTS_SHARE_PATH", test.path)
			t.Setenv("ARTIFACTS_SHARE_RETENTION_DAYS", test.days)
			t.Setenv("ARTIFACTS_SHARE_MAX_SIZE", test.size)

			var cfg Config
			applyEnvOverrides(&cfg)

			var got *ArtifactsShare
			if cfg.Artifacts != nil {
				got = cfg.Artifacts.Share
			}

			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("share = %+v, want %+v", got, test.want)
			}

			// The browser learns the limits, never the server's storage path.
			data, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			if test.path != "" && strings.Contains(string(data), test.path) {
				t.Fatalf("browser config exposes the share path: %s", data)
			}
		})
	}
}
