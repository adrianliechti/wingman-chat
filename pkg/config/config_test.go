package config

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestInternetOverrides(t *testing.T) {
	for _, tc := range []struct {
		name    string
		initial *Internet
		env     map[string]string
		want    *Internet
	}{
		{"researcher only", nil, map[string]string{"INTERNET_ENABLED": "true", "INTERNET_RESEARCHER": "web"}, &Internet{Researcher: "web"}},
		{"override YAML without enable flag", &Internet{Researcher: "old"}, map[string]string{"INTERNET_RESEARCHER": "web"}, &Internet{Researcher: "web"}},
		{"explicit disable", &Internet{Searcher: "web"}, map[string]string{"INTERNET_ENABLED": "false"}, nil},
		{"selector alone does not enable", nil, map[string]string{"INTERNET_RESEARCHER": "web"}, nil},
		{"clear gateway to use local model", &Internet{Researcher: "web", Model: "gpt-6-luna", Elicitation: true}, map[string]string{"INTERNET_RESEARCHER": "", "INTERNET_ELICITATION": "false"}, &Internet{Model: "gpt-6-luna"}},
		{"all selectors", nil, map[string]string{"INTERNET_ENABLED": "true", "INTERNET_MODEL": " gpt-6-luna ", "INTERNET_GUARD": "guard", "INTERNET_SEARCHER": "search", "INTERNET_SCRAPER": "scrape", "INTERNET_RESEARCHER": "research", "INTERNET_ELICITATION": "true"}, &Internet{Model: "gpt-6-luna", Guard: "guard", Searcher: "search", Scraper: "scrape", Researcher: "research", Elicitation: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, key := range []string{"INTERNET_ENABLED", "INTERNET_MODEL", "INTERNET_GUARD", "INTERNET_SEARCHER", "INTERNET_SCRAPER", "INTERNET_RESEARCHER", "INTERNET_ELICITATION"} {
				// Preserve the caller environment while making absence testable.
				t.Setenv(key, "")
				os.Unsetenv(key)
			}
			for key, value := range tc.env {
				t.Setenv(key, value)
			}
			cfg := Config{Internet: tc.initial}
			applyInternetOverrides(&cfg)
			if !reflect.DeepEqual(cfg.Internet, tc.want) {
				t.Fatalf("got=%+v want=%+v", cfg.Internet, tc.want)
			}
			data, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			var decoded Config
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(decoded.Internet, tc.want) {
				t.Fatalf("browser config lost internet fields: %s", data)
			}
		})
	}
}

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
