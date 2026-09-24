package config

import (
	"os"
	"reflect"
	"testing"
)

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
