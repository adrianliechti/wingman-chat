package config

import (
	"encoding/json"
	"os"
	"reflect"
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

func TestLoadYAMLCompatibility(t *testing.T) {
	filename := t.TempDir() + "/tools.yaml"
	if err := os.WriteFile(filename, []byte(`
- &defaults
  id: base
  approval:
    mode: individual
  headers:
    X-Tenant: "0123"
- <<: *defaults
  id: inherited
  url: https://mcp.example.test/api
  futureSetting: ignored
`), 0600); err != nil {
		t.Fatal(err)
	}
	var tools []Tool
	loadYAML(filename, &tools)
	want := []Tool{
		{ID: "base", Approval: &Approval{Mode: ApprovalIndividual}, Headers: map[string]string{"X-Tenant": "0123"}},
		{ID: "inherited", Approval: &Approval{Mode: ApprovalIndividual}, URL: "https://mcp.example.test/api", Headers: map[string]string{"X-Tenant": "0123"}},
	}
	if !reflect.DeepEqual(tools, want) {
		t.Fatalf("YAML aliases or quoted strings changed: got %#v, want %#v", tools, want)
	}
}

func TestDriveAuthEnvironmentExpansion(t *testing.T) {
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

	const secret = "secret: # 'quoted' \"double\" \\path\n$DRIVE_TEST_CLIENT_ID ${DRIVE_TEST_TENANT}"
	t.Setenv("DRIVE_TEST_TENANT", "example-tenant")
	t.Setenv("DRIVE_TEST_CLIENT_ID", "example-client")
	t.Setenv("DRIVE_TEST_CLIENT_SECRET", secret)
	t.Setenv("DRIVE_TEST_SCOPE", "https://graph.microsoft.com/.default")
	t.Setenv("DRIVE_TEST_EMPTY", "")
	// Register cleanup before unsetting the variable to make this independent
	// of the environment running the tests.
	t.Setenv("DRIVE_TEST_UNSET", "")
	if err := os.Unsetenv("DRIVE_TEST_UNSET"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("drives.yaml", []byte(`
- id: expanded
  type: onedrive
  auth:
    issuer: https://login.microsoftonline.com/${DRIVE_TEST_TENANT}/v2.0
    client_id: $DRIVE_TEST_CLIENT_ID
    client_secret: '${DRIVE_TEST_CLIENT_SECRET}'
    scope: ${DRIVE_TEST_SCOPE}
- id: literal
  type: sharepoint
  auth:
    issuer: https://login.microsoftonline.com/literal/v2.0
    client_id: literal-client
    client_secret: literal-secret
    scope: https://graph.microsoft.com/.default
- id: missing
  type: onedrive
  auth:
    issuer: ${DRIVE_TEST_UNSET}
    client_id: $DRIVE_TEST_UNSET
    client_secret: ${DRIVE_TEST_EMPTY}
- id: local
  path: /data
`), 0600); err != nil {
		t.Fatal(err)
	}

	cfg := Load()
	want := []Drive{
		{ID: "expanded", Type: "onedrive", Auth: &DriveAuth{
			Issuer:       "https://login.microsoftonline.com/example-tenant/v2.0",
			ClientID:     "example-client",
			ClientSecret: secret,
			Scope:        "https://graph.microsoft.com/.default",
		}},
		{ID: "literal", Type: "sharepoint", Auth: &DriveAuth{
			Issuer:       "https://login.microsoftonline.com/literal/v2.0",
			ClientID:     "literal-client",
			ClientSecret: "literal-secret",
			Scope:        "https://graph.microsoft.com/.default",
		}},
		{ID: "missing", Type: "onedrive", Auth: &DriveAuth{}},
		{ID: "local", Path: "/data"},
	}
	if !reflect.DeepEqual(cfg.Drives, want) {
		t.Fatalf("drives = %#v, want %#v", cfg.Drives, want)
	}

	data, err := json.Marshal(cfg.Drives)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `[{"id":"expanded"},{"id":"literal"},{"id":"missing"},{"id":"local"}]` {
		t.Fatalf("unexpected browser drive config: %s", data)
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
  approval:
    mode: delegated
- id: direct
  approval:
    mode: individual
  url: https://mcp.example.test/api
  headers:
    X-Tenant: example
- id: explicit-none
  approval:
    mode: none
- id: implicit-none
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
	if len(browser.Tools) != 4 || browser.Tools[0].URL != "" || browser.Tools[1].Headers["X-Tenant"] != "example" {
		t.Fatalf("tools.yaml lost MCP fields: %s", data)
	}
	approvals := []*Approval{{Mode: ApprovalDelegated}, {Mode: ApprovalIndividual}, {Mode: ApprovalNone}, nil}
	for i, expected := range approvals {
		if !reflect.DeepEqual(browser.Tools[i].Approval, expected) {
			t.Fatalf("tools.yaml lost approval for %s: %s", browser.Tools[i].ID, data)
		}
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
