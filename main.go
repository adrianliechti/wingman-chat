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

	disclaimer := os.Getenv("DISCLAIMER")

	token := platformToken()

	platformURL := platformURL()
	realtimeURL := realtimeURL()

	bridgeURL := os.Getenv("BRIDGE_URL")

	tts := os.Getenv("TTS_ENABLED") == "true"
	stt := os.Getenv("STT_ENABLED") == "true"

	voice := os.Getenv("VOICE_ENABLED") == "true"
	vision := os.Getenv("VISION_ENABLED") == "true"

	internet := os.Getenv("INTERNET_ENABLED") == "true"

	artifacts := os.Getenv("ARTIFACTS_ENABLED") == "true"

	repository := os.Getenv("REPOSITORY_ENABLED") == "true"
	repositoryEmbedder := os.Getenv("REPOSITORY_EMBEDDER")
	repositoryExtractor := os.Getenv("REPOSITORY_EXTRACTOR")

	mux := http.NewServeMux()
	dist := os.DirFS("dist")

	mux.Handle("/", http.FileServerFS(dist))

	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		type modelType struct {
			ID string `json:"id,omitempty" yaml:"id,omitempty"`

			Name        string `json:"name,omitempty" yaml:"name,omitempty"`
			Description string `json:"description,omitempty" yaml:"description,omitempty"`

			Prompts []string `json:"prompts,omitempty" yaml:"prompts,omitempty"`
		}

		type ttsType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type sttType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type voiceType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type visionType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type bridgeType struct {
			URL string `json:"url,omitempty" yaml:"url,omitempty"`
		}

		type artifactsType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type internetType struct {
			Enabled bool `json:"enabled,omitempty" yaml:"enabled,omitempty"`
		}

		type repositoryType struct {
			Enabled   bool   `json:"enabled,omitempty" yaml:"enabled,omitempty"`
			Embedder  string `json:"embedder,omitempty" yaml:"embedder,omitempty"`
			Extractor string `json:"extractor,omitempty" yaml:"extractor,omitempty"`
		}

		type translatorType struct {
			Enabled   bool     `json:"enabled,omitempty" yaml:"enabled,omitempty"`
			Files     []string `json:"files,omitempty" yaml:"files,omitempty"`
			Languages []string `json:"languages,omitempty" yaml:"languages,omitempty"`
		}

		type backgroundType struct {
			URL string `json:"url,omitempty" yaml:"url,omitempty"`
		}

		type configType struct {
			Title      string `json:"title,omitempty" yaml:"title,omitempty"`
			Disclaimer string `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`

			Models []modelType `json:"models,omitempty" yaml:"models,omitempty"`

			TTS    *ttsType    `json:"tts,omitempty" yaml:"tts,omitempty"`
			STT    *sttType    `json:"stt,omitempty" yaml:"stt,omitempty"`
			Voice  *voiceType  `json:"voice,omitempty" yaml:"voice,omitempty"`
			Vision *visionType `json:"vision,omitempty" yaml:"vision,omitempty"`

			Bridge     *bridgeType     `json:"bridge,omitempty" yaml:"bridge,omitempty"`
			Internet   *internetType   `json:"internet,omitempty" yaml:"internet,omitempty"`
			Artifacts  *artifactsType  `json:"artifacts,omitempty" yaml:"artifacts,omitempty"`
			Repository *repositoryType `json:"repository,omitempty" yaml:"repository,omitempty"`
			Translator *translatorType `json:"translator,omitempty" yaml:"translator,omitempty"`

			Backgrounds map[string][]backgroundType `json:"backgrounds,omitempty" yaml:"backgrounds,omitempty"`
		}

		config := configType{
			Title:      title,
			Disclaimer: disclaimer,
		}

		if data, err := os.ReadFile("models.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Models)
		}

		if data, err := os.ReadFile("translator.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Translator)
			config.Translator.Enabled = true
		}

		if data, err := os.ReadFile("backgrounds.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Backgrounds)
		}

		if tts {
			config.TTS = &ttsType{
				Enabled: true,
			}
		}

		if stt {
			config.STT = &sttType{
				Enabled: true,
			}
		}

		if voice {
			config.Voice = &voiceType{
				Enabled: true,
			}
		}

		if vision {
			config.Vision = &visionType{
				Enabled: true,
			}
		}

		if bridgeURL != "" {
			config.Bridge = &bridgeType{
				URL: bridgeURL,
			}
		}

		if artifacts {
			config.Artifacts = &artifactsType{
				Enabled: true,
			}
		}

		if internet {
			config.Internet = &internetType{
				Enabled: true,
			}
		}

		if repository {
			config.Repository = &repositoryType{
				Enabled:   true,
				Embedder:  repositoryEmbedder,
				Extractor: repositoryExtractor,
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
					"src":     "/icon_light.png",
					"sizes":   "512x512",
					"type":    "image/png",
					"purpose": "any maskable",
				},
				{
					"src":   "/icon_light.svg",
					"sizes": "any",
					"type":  "image/svg+xml",
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(manifest)
	})

	if realtimeURL != nil {
		mux.Handle("/api/v1/realtime", http.StripPrefix("/api", &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) {
				r.SetURL(realtimeURL)

				if token != "" {
					r.Out.Header.Set("Authorization", "Bearer "+token)
				}
			},
		}))
	}

	mux.Handle("/api/", http.StripPrefix("/api", &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(platformURL)

			if token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+token)
			}
		},
	}))

	http.ListenAndServe(":8000", mux)
}

func platformToken() string {
	if val := os.Getenv("WINGMAN_TOKEN"); val != "" {
		return val
	}

	if val := os.Getenv("OPENAI_API_KEY"); val != "" {
		return val
	}

	return ""
}

func platformURL() *url.URL {
	if val, ok := os.LookupEnv("WINGMAN_URL"); ok {
		u, _ := url.Parse(val)

		if u != nil && u.Host != "" {
			u.Path = strings.TrimRight(u.Path, "/")
			u.Path = strings.TrimRight(u.Path, "/v1")

			return u
		}
	}

	if val, ok := os.LookupEnv("OPENAI_BASE_URL"); ok {
		u, _ := url.Parse(val)

		if u != nil && u.Host != "" {
			u.Path = strings.TrimRight(u.Path, "/")
			u.Path = strings.TrimRight(u.Path, "/v1")

			return u
		}
	}

	panic("WINGMAN_URL is not set or invalid")
}

func realtimeURL() *url.URL {
	if val, ok := os.LookupEnv("REALTIME_PROXY"); ok {
		u, _ := url.Parse(val)

		if u != nil && u.Host != "" {
			u.Path = strings.TrimRight(u.Path, "/")
			u.Path = strings.TrimRight(u.Path, "/v1")

			return u
		}
	}

	return nil
}
