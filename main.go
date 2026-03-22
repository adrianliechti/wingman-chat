package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strconv"
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

	tts := os.Getenv("TTS_ENABLED") == "true"
	ttsModel := os.Getenv("TTS_MODEL")
	stt := os.Getenv("STT_ENABLED") == "true"
	sttModel := os.Getenv("STT_MODEL")

	voice := os.Getenv("VOICE_ENABLED") == "true"
	voiceModel := os.Getenv("VOICE_MODEL")
	voiceTranscriber := os.Getenv("VOICE_TRANSCRIBER")
	vision := os.Getenv("VISION_ENABLED") == "true"

	internet := os.Getenv("INTERNET_ENABLED") == "true"
	internetScraper := os.Getenv("INTERNET_SCRAPER")
	internetSearcher := os.Getenv("INTERNET_SEARCHER")
	internetResearcher := os.Getenv("INTERNET_RESEARCHER")
	internetElicitation := os.Getenv("INTERNET_ELICITATION") == "true"

	researcher := os.Getenv("RESEARCHER_ENABLED") == "true"
	researcherModel := os.Getenv("RESEARCHER_MODEL")

	renderer := os.Getenv("RENDERER_ENABLED") == "true"
	rendererModel := os.Getenv("RENDERER_MODEL")
	rendererDisclaimer := os.Getenv("RENDERER_DISCLAIMER")
	rendererElicitation := os.Getenv("RENDERER_ELICITATION") == "true"

	extractor := os.Getenv("EXTRACTOR_ENABLED") == "true"
	extractorModel := os.Getenv("EXTRACTOR_MODEL")

	artifacts := os.Getenv("ARTIFACTS_ENABLED") == "true"

	repository := os.Getenv("REPOSITORY_ENABLED") == "true"
	repositoryEmbedder := os.Getenv("REPOSITORY_EMBEDDER")
	repositoryExtractor := os.Getenv("REPOSITORY_EXTRACTOR")
	repositoryContextPages := os.Getenv("REPOSITORY_CONTEXT_PAGES")

	memory := os.Getenv("MEMORY_ENABLED") == "true"
	workflow := os.Getenv("WORKFLOW_ENABLED") == "true"

	chatRetentionDays := os.Getenv("CHAT_RETENTION_DAYS")

	supportURL := os.Getenv("SUPPORT_URL")
	supportEmail := os.Getenv("SUPPORT_EMAIL")

	mux := http.NewServeMux()
	dist := os.DirFS("dist")

	// SPA fallback: serve index.html for routes that don't match real files
	mux.Handle("/", spaHandler(dist))

	mux.HandleFunc("GET /config.json", func(w http.ResponseWriter, r *http.Request) {
		type toolType struct {
			ID string `json:"id,omitempty" yaml:"id,omitempty"`

			URL string `json:"url,omitempty" yaml:"url,omitempty"`

			Name        string `json:"name,omitempty" yaml:"name,omitempty"`
			Description string `json:"description,omitempty" yaml:"description,omitempty"`
		}

		type modelType struct {
			ID string `json:"id,omitempty" yaml:"id,omitempty"`

			Name        string `json:"name,omitempty" yaml:"name,omitempty"`
			Description string `json:"description,omitempty" yaml:"description,omitempty"`

			Effort    string `json:"effort,omitempty" yaml:"effort,omitempty"`
			Summary   string `json:"summary,omitempty" yaml:"summary,omitempty"`
			Verbosity string `json:"verbosity,omitempty" yaml:"verbosity,omitempty"`

			MCP []string `json:"mcp,omitempty" yaml:"mcp,omitempty"`

			Prompts []string `json:"prompts,omitempty" yaml:"prompts,omitempty"`
		}

		type ttsType struct {
			Model string `json:"model,omitempty" yaml:"model,omitempty"`
		}

		type sttType struct {
			Model string `json:"model,omitempty" yaml:"model,omitempty"`
		}

		type voiceType struct {
			Model       string `json:"model,omitempty" yaml:"model,omitempty"`
			Transcriber string `json:"transcriber,omitempty" yaml:"transcriber,omitempty"`
		}

		type visionType struct {
			Files []string `json:"files,omitempty" yaml:"files,omitempty"`
		}

		type textType struct {
			Files []string `json:"files,omitempty" yaml:"files,omitempty"`
		}

		type extractorType struct {
			Model string   `json:"model,omitempty" yaml:"model,omitempty"`
			Files []string `json:"files,omitempty" yaml:"files,omitempty"`
		}

		type internetType struct {
			Searcher    string `json:"searcher,omitempty" yaml:"searcher,omitempty"`
			Scraper     string `json:"scraper,omitempty" yaml:"scraper,omitempty"`
			Researcher  string `json:"researcher,omitempty" yaml:"researcher,omitempty"`
			Elicitation bool   `json:"elicitation,omitempty" yaml:"elicitation,omitempty"`
		}

		type rendererType struct {
			Model       string `json:"model,omitempty" yaml:"model,omitempty"`
			Disclaimer  string `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`
			Elicitation bool   `json:"elicitation,omitempty" yaml:"elicitation,omitempty"`
		}

		type artifactsType struct{}

		type repositoryType struct {
			Embedder  string `json:"embedder,omitempty" yaml:"embedder,omitempty"`
			Extractor string `json:"extractor,omitempty" yaml:"extractor,omitempty"`

			ContextPages *int `json:"context_pages,omitempty" yaml:"context_pages,omitempty"`
		}

		type workflowType struct{}

		type memoryType struct{}

		type researcherType struct {
			Model string `json:"model,omitempty" yaml:"model,omitempty"`
		}

		type chatType struct {
			RetentionDays *int `json:"retentionDays,omitempty" yaml:"retentionDays,omitempty"`
		}

		type translatorType struct {
			Model     string   `json:"model,omitempty" yaml:"model,omitempty"`
			Files     []string `json:"files,omitempty" yaml:"files,omitempty"`
			Languages []string `json:"languages,omitempty" yaml:"languages,omitempty"`
		}

		type backgroundType struct {
			URL string `json:"url,omitempty" yaml:"url,omitempty"`
		}

		type supportType struct {
			URL   string `json:"url,omitempty" yaml:"url,omitempty"`
			Email string `json:"email,omitempty" yaml:"email,omitempty"`
		}

		type configType struct {
			Title      string       `json:"title,omitempty" yaml:"title,omitempty"`
			Disclaimer string       `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`
			Support    *supportType `json:"support,omitempty" yaml:"support,omitempty"`

			Tools  []toolType  `json:"tools,omitempty" yaml:"tools,omitempty"`
			Models []modelType `json:"models,omitempty" yaml:"models,omitempty"`

			TTS *ttsType `json:"tts,omitempty" yaml:"tts,omitempty"`
			STT *sttType `json:"stt,omitempty" yaml:"stt,omitempty"`

			Voice     *voiceType     `json:"voice,omitempty" yaml:"voice,omitempty"`
			Vision    *visionType    `json:"vision,omitempty" yaml:"vision,omitempty"`
			Text      *textType      `json:"text,omitempty" yaml:"text,omitempty"`
			Extractor *extractorType `json:"extractor,omitempty" yaml:"extractor,omitempty"`

			Internet *internetType `json:"internet,omitempty" yaml:"internet,omitempty"`
			Renderer *rendererType `json:"renderer,omitempty" yaml:"renderer,omitempty"`

			Artifacts  *artifactsType  `json:"artifacts,omitempty" yaml:"artifacts,omitempty"`
			Repository *repositoryType `json:"repository,omitempty" yaml:"repository,omitempty"`

			Workflow   *workflowType   `json:"workflow,omitempty" yaml:"workflow,omitempty"`
			Memory     *memoryType     `json:"memory,omitempty" yaml:"memory,omitempty"`
			Researcher *researcherType `json:"researcher,omitempty" yaml:"researcher,omitempty"`
			Translator *translatorType `json:"translator,omitempty" yaml:"translator,omitempty"`

			Chat *chatType `json:"chat,omitempty" yaml:"chat,omitempty"`

			Backgrounds map[string][]backgroundType `json:"backgrounds,omitempty" yaml:"backgrounds,omitempty"`
		}

		config := configType{
			Title:      title,
			Disclaimer: disclaimer,
		}

		if supportURL != "" || supportEmail != "" {
			config.Support = &supportType{
				URL:   supportURL,
				Email: supportEmail,
			}
		}

		if data, err := os.ReadFile("tools.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Tools)
		}

		if data, err := os.ReadFile("models.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Models)
		}

		if data, err := os.ReadFile("translator.yaml"); err == nil {
			config.Translator = &translatorType{}
			yaml.Unmarshal(data, config.Translator)
		}

		if data, err := os.ReadFile("vision.yaml"); err == nil {
			config.Vision = &visionType{}
			yaml.Unmarshal(data, config.Vision)
		}

		if data, err := os.ReadFile("text.yaml"); err == nil {
			config.Text = &textType{}
			yaml.Unmarshal(data, config.Text)
		}

		if data, err := os.ReadFile("extractor.yaml"); err == nil {
			config.Extractor = &extractorType{}
			yaml.Unmarshal(data, config.Extractor)
		}

		if data, err := os.ReadFile("internet.yaml"); err == nil {
			config.Internet = &internetType{}
			yaml.Unmarshal(data, config.Internet)
		}

		if data, err := os.ReadFile("renderer.yaml"); err == nil {
			config.Renderer = &rendererType{}
			yaml.Unmarshal(data, config.Renderer)
		}

		if data, err := os.ReadFile("repository.yaml"); err == nil {
			config.Repository = &repositoryType{}
			yaml.Unmarshal(data, config.Repository)
		}

		if data, err := os.ReadFile("backgrounds.yaml"); err == nil {
			yaml.Unmarshal(data, &config.Backgrounds)
		}

		// Environment variables can override/enable configs
		// Presence of the config object means enabled

		if tts {
			if config.TTS == nil {
				config.TTS = &ttsType{}
			}

			if ttsModel != "" {
				config.TTS.Model = ttsModel
			}
		}

		if stt {
			if config.STT == nil {
				config.STT = &sttType{}
			}

			if sttModel != "" {
				config.STT.Model = sttModel
			}
		}

		if voice {
			if config.Voice == nil {
				config.Voice = &voiceType{}
			}

			if voiceModel != "" {
				config.Voice.Model = voiceModel
			}

			if voiceTranscriber != "" {
				config.Voice.Transcriber = voiceTranscriber
			}
		}

		if vision && config.Vision == nil {
			config.Vision = &visionType{}
		}

		if internet {
			if config.Internet == nil {
				config.Internet = &internetType{}
			}

			if internetScraper != "" {
				config.Internet.Scraper = internetScraper
			}

			if internetSearcher != "" {
				config.Internet.Searcher = internetSearcher
			}

			if internetResearcher != "" {
				config.Internet.Researcher = internetResearcher
			}

			if internetElicitation {
				config.Internet.Elicitation = true
			}
		}

		if renderer {
			if config.Renderer == nil {
				config.Renderer = &rendererType{}
			}

			if rendererModel != "" {
				config.Renderer.Model = rendererModel
			}

			if rendererDisclaimer != "" {
				config.Renderer.Disclaimer = rendererDisclaimer
			}

			if rendererElicitation {
				config.Renderer.Elicitation = true
			}
		}

		if artifacts {
			config.Artifacts = &artifactsType{}
		}

		if repository {
			if config.Repository == nil {
				config.Repository = &repositoryType{}
			}

			if repositoryEmbedder != "" {
				config.Repository.Embedder = repositoryEmbedder
			}

			if repositoryExtractor != "" {
				config.Repository.Extractor = repositoryExtractor
			}

			if n, err := strconv.Atoi(repositoryContextPages); err == nil && n > 0 {
				config.Repository.ContextPages = &n
			}
		}

		if workflow {
			config.Workflow = &workflowType{}
		}

		if memory {
			config.Memory = &memoryType{}
		}

		if researcher {
			if config.Researcher == nil {
				config.Researcher = &researcherType{}
			}

			if researcherModel != "" {
				config.Researcher.Model = researcherModel
			}
		}

		if extractor {
			if config.Extractor == nil {
				config.Extractor = &extractorType{}
			}

			if extractorModel != "" {
				config.Extractor.Model = extractorModel
			}
		}

		if chatRetentionDays != "" {
			if n, err := strconv.Atoi(chatRetentionDays); err == nil && n > 0 {
				config.Chat = &chatType{
					RetentionDays: &n,
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
	})

	// mux.HandleFunc("GET /manifest.json", func(w http.ResponseWriter, r *http.Request) {
	// 	manifest := map[string]any{
	// 		"name":             title,
	// 		"short_name":       title,
	// 		"start_url":        "/",
	// 		"display":          "standalone",
	// 		"background_color": "#0a0a0a",
	// 		"theme_color":      "#0a0a0a",
	// 		"orientation":      "portrait",
	// 		"icons": []map[string]any{
	// 			{
	// 				"src":     "/icon_light.png",
	// 				"sizes":   "512x512",
	// 				"type":    "image/png",
	// 				"purpose": "any",
	// 			},
	// 			{
	// 				"src":     "/icon_app.png",
	// 				"sizes":   "512x512",
	// 				"type":    "image/png",
	// 				"purpose": "maskable",
	// 			},
	// 		},
	// 	}

	// 	w.Header().Set("Content-Type", "application/json")
	// 	json.NewEncoder(w).Encode(manifest)
	// })

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

// spaHandler serves static files from the given filesystem, falling back to
// index.html for paths that don't match a real file. This lets the frontend
// router handle client-side routes like /chat/123.
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServerFS(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clean the path and try to open it as a real file
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}

		_, err := fs.Stat(root, p)
		if err == nil {
			// File exists — serve it normally
			fileServer.ServeHTTP(w, r)
			return
		}

		// File doesn't exist — serve index.html and let the SPA router handle it
		indexFile, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexFile)
	})
}
