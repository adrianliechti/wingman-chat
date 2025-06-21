package main

import (
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

func main() {
	title := os.Getenv("TITLE")

	if title == "" {
		title = "Wingman AI"
	}

	token := os.Getenv("OPENAI_API_KEY")
	target, _ := url.Parse(os.Getenv("OPENAI_BASE_URL"))

	if target.Host == "" {
		target, _ = url.Parse("https://api.openai.com/v1")
	}

	if target != nil {
		target.Path = strings.TrimRight(target.Path, "/")
		target.Path = strings.TrimRight(target.Path, "/v1")
	}

	realtime, _ := url.Parse(os.Getenv("OPENAI_REALTIME_PROXY"))

	if realtime == nil || realtime.Host == "" {
		realtime = nil
	}

	if realtime != nil {
		realtime.Path = strings.TrimRight(realtime.Path, "/")
		realtime.Path = strings.TrimRight(realtime.Path, "/v1")
	}

	bridgeURL := os.Getenv("BRIDGE_BASE_URL")

	mux := http.NewServeMux()
	dist := os.DirFS("dist")

	mux.Handle("/", http.FileServerFS(dist))

	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		type modelType struct {
			ID string `json:"id,omitempty" yaml:"id,omitempty"`

			Name        string `json:"name,omitempty" yaml:"name,omitempty"`
			Description string `json:"description,omitempty" yaml:"description,omitempty"`
		}

		type voiceType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type bridgeType struct {
			URL string `json:"url,omitempty" yaml:"url,omitempty"`
		}

		type configType struct {
			Title string `json:"title,omitempty" yaml:"title,omitempty"`

			Models []modelType `json:"models,omitempty" yaml:"models,omitempty"`

			Voice  *voiceType  `json:"voice,omitempty" yaml:"voice,omitempty"`
			Bridge *bridgeType `json:"bridge,omitempty" yaml:"bridge,omitempty"`
		}

		config := configType{
			Title: title,
		}

		if data, err := os.ReadFile("models.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Models)
		}

		if realtime != nil {
			config.Voice = &voiceType{
				Enabled: true,
			}
		}

		if bridgeURL != "" {
			config.Bridge = &bridgeType{
				URL: bridgeURL,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
	})

	mux.HandleFunc("GET /manifest.json", func(w http.ResponseWriter, r *http.Request) {
		manifest := map[string]any{
			"name":             title,
			"short_name":       title,
			"start_url":        "/",
			"display":          "standalone",
			"background_color": "#0a0a0a",
			"theme_color":      "#0a0a0a",
			"orientation":      "portrait",
			"icons": []map[string]any{
				{
					"src":     "/icon.png",
					"sizes":   "512x512",
					"type":    "image/png",
					"purpose": "any maskable",
				},
				{
					"src":   "/logo.svg",
					"sizes": "any",
					"type":  "image/svg+xml",
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(manifest)
	})

	if realtime != nil {
		mux.Handle("/api/v1/realtime", http.StripPrefix("/api", &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) {
				r.SetURL(realtime)

				if token != "" {
					r.Out.Header.Set("Authorization", "Bearer "+token)
				}
			},
		}))
	}

	mux.Handle("/api/", http.StripPrefix("/api", &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)

			if token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+token)
			}
		},
	}))

	http.ListenAndServe(":8000", mux)
}
