package config

type Config struct {
	Title      string   `json:"title,omitempty" yaml:"title,omitempty"`
	Disclaimer string   `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`
	Bridge     *Bridge  `json:"bridge,omitempty" yaml:"bridge,omitempty"`
	Support    *Support `json:"support,omitempty" yaml:"support,omitempty"`

	Tools  []Tool  `json:"tools,omitempty" yaml:"tools,omitempty"`
	Models []Model `json:"models,omitempty" yaml:"models,omitempty"`

	Drives []Drive `json:"drives,omitempty" yaml:"drives,omitempty"`

	TTS *TTS `json:"tts,omitempty" yaml:"tts,omitempty"`
	STT *STT `json:"stt,omitempty" yaml:"stt,omitempty"`

	Voice     *Voice     `json:"voice,omitempty" yaml:"voice,omitempty"`
	Vision    *Vision    `json:"vision,omitempty" yaml:"vision,omitempty"`
	Text      *Text      `json:"text,omitempty" yaml:"text,omitempty"`
	Extractor *Extractor `json:"extractor,omitempty" yaml:"extractor,omitempty"`

	Internet   *Internet   `json:"internet,omitempty" yaml:"internet,omitempty"`
	Renderer   *Renderer   `json:"renderer,omitempty" yaml:"renderer,omitempty"`
	Translator *Translator `json:"translator,omitempty" yaml:"translator,omitempty"`

	Artifacts  *Artifacts  `json:"artifacts,omitempty" yaml:"artifacts,omitempty"`
	Repository *Repository `json:"repository,omitempty" yaml:"repository,omitempty"`

	Memory   *Memory   `json:"memory,omitempty" yaml:"memory,omitempty"`
	Notebook *Notebook `json:"notebook,omitempty" yaml:"notebook,omitempty"`

	Chat *Chat `json:"chat,omitempty" yaml:"chat,omitempty"`

	ChatStore *ChatStore `json:"chatstore,omitempty" yaml:"chatstore,omitempty"`

	Telemetry *Telemetry `json:"telemetry,omitempty" yaml:"telemetry,omitempty"`

	Backgrounds map[string][]Background `json:"backgrounds,omitempty" yaml:"backgrounds,omitempty"`
}

type Support struct {
	URL string `json:"url,omitempty" yaml:"url,omitempty"`
}

type Tool struct {
	ID          string `json:"id,omitempty" yaml:"id,omitempty"`
	URL         string `json:"url,omitempty" yaml:"url,omitempty"`
	Name        string `json:"name,omitempty" yaml:"name,omitempty"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
	Icon        string `json:"icon,omitempty" yaml:"icon,omitempty"`
}

type ModelTools struct {
	Enabled  []string `json:"enabled,omitempty" yaml:"enabled,omitempty"`
	Disabled []string `json:"disabled,omitempty" yaml:"disabled,omitempty"`
}

type Model struct {
	ID               string      `json:"id,omitempty" yaml:"id,omitempty"`
	Name             string      `json:"name,omitempty" yaml:"name,omitempty"`
	Description      string      `json:"description,omitempty" yaml:"description,omitempty"`
	Instructions     string      `json:"instructions,omitempty" yaml:"instructions,omitempty"`
	Effort           string      `json:"effort,omitempty" yaml:"effort,omitempty"`
	SupportedEfforts []string    `json:"supportedEfforts,omitempty" yaml:"supportedEfforts,omitempty"`
	Summary          string      `json:"summary,omitempty" yaml:"summary,omitempty"`
	Verbosity        string      `json:"verbosity,omitempty" yaml:"verbosity,omitempty"`
	CompactThreshold int         `json:"compactThreshold,omitempty" yaml:"compactThreshold,omitempty"`
	Tools            *ModelTools `json:"tools,omitempty" yaml:"tools,omitempty"`
}

type TTS struct {
	Model  string            `json:"model,omitempty" yaml:"model,omitempty"`
	Voices map[string]string `json:"voices,omitempty" yaml:"voices,omitempty"`
}

type STT struct {
	Model string `json:"model,omitempty" yaml:"model,omitempty"`
}

type Voice struct {
	Model       string `json:"model,omitempty" yaml:"model,omitempty"`
	Transcriber string `json:"transcriber,omitempty" yaml:"transcriber,omitempty"`
}

type Vision struct {
	Files []string `json:"files,omitempty" yaml:"files,omitempty"`
}

type Text struct {
	Files []string `json:"files,omitempty" yaml:"files,omitempty"`
}

type Extractor struct {
	Model string   `json:"model,omitempty" yaml:"model,omitempty"`
	Files []string `json:"files,omitempty" yaml:"files,omitempty"`
}

type Internet struct {
	Searcher    string `json:"searcher,omitempty" yaml:"searcher,omitempty"`
	Scraper     string `json:"scraper,omitempty" yaml:"scraper,omitempty"`
	Researcher  string `json:"researcher,omitempty" yaml:"researcher,omitempty"`
	Elicitation bool   `json:"elicitation,omitempty" yaml:"elicitation,omitempty"`
}

type Renderer struct {
	Model       string `json:"model,omitempty" yaml:"model,omitempty"`
	Disclaimer  string `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`
	Elicitation bool   `json:"elicitation,omitempty" yaml:"elicitation,omitempty"`
}

type Artifacts struct{}

type Repository struct {
	Embedder  string `json:"embedder,omitempty" yaml:"embedder,omitempty"`
	Extractor string `json:"extractor,omitempty" yaml:"extractor,omitempty"`
}

type Memory struct{}

type Notebook struct {
	Model         string                 `json:"model,omitempty" yaml:"model,omitempty"`
	Renderer      string                 `json:"renderer,omitempty" yaml:"renderer,omitempty"`
	Slides        []NotebookSlide        `json:"slides,omitempty" yaml:"slides,omitempty"`
	Podcasts      []NotebookPodcast      `json:"podcasts,omitempty" yaml:"podcasts,omitempty"`
	Reports       []NotebookReport       `json:"reports,omitempty" yaml:"reports,omitempty"`
	Infographics  []NotebookInfographic  `json:"infographics,omitempty" yaml:"infographics,omitempty"`
	Processes     []NotebookProcess      `json:"processes,omitempty" yaml:"processes,omitempty"`
	Architectures []NotebookArchitecture `json:"architectures,omitempty" yaml:"architectures,omitempty"`
}

type Chat struct {
	Instructions  string `json:"instructions,omitempty" yaml:"instructions,omitempty"`
	RetentionDays *int   `json:"retentionDays,omitempty" yaml:"retentionDays,omitempty"`
	Summarizer    string `json:"summarizer,omitempty" yaml:"summarizer,omitempty"`
	Optimizer     string `json:"optimizer,omitempty" yaml:"optimizer,omitempty"`

	Classification *Classification `json:"classification,omitempty" yaml:"classification,omitempty"`
	Categories     []Category      `json:"categories,omitempty" yaml:"categories,omitempty"`
	Risks          []Risk          `json:"risks,omitempty" yaml:"risks,omitempty"`
}

type Classification struct {
	Model     string  `json:"model,omitempty" yaml:"model,omitempty"`
	Threshold float64 `json:"threshold,omitempty" yaml:"threshold,omitempty"`
}

type Category struct {
	Name        string  `json:"name,omitempty" yaml:"name,omitempty"`
	Description string  `json:"description,omitempty" yaml:"description,omitempty"`
	Consent     any     `json:"consent,omitempty" yaml:"consent,omitempty"`
	Threshold   float64 `json:"threshold,omitempty" yaml:"threshold,omitempty"`
}

type Risk struct {
	Name        string  `json:"name,omitempty" yaml:"name,omitempty"`
	Description string  `json:"description,omitempty" yaml:"description,omitempty"`
	Severity    string  `json:"severity,omitempty" yaml:"severity,omitempty"`
	Message     string  `json:"message,omitempty" yaml:"message,omitempty"`
	Threshold   float64 `json:"threshold,omitempty" yaml:"threshold,omitempty"`
}

// ChatStore configures the server-side chat store. Its presence in the
// JSON-serialized config is the frontend's signal to switch from
// OPFS-only mode to server-synced mode. Sensitive fields (Path) stay
// server-private via the json:"-" tag.
type ChatStore struct {
	Type string `json:"-" yaml:"type,omitempty"`
	Path string `json:"-" yaml:"path,omitempty"`
}

type Translator struct {
	Model     string   `json:"model,omitempty" yaml:"model,omitempty"`
	Files     []string `json:"files,omitempty" yaml:"files,omitempty"`
	Languages []string `json:"languages,omitempty" yaml:"languages,omitempty"`
}

type Telemetry struct{}

type Background struct {
	URL string `json:"url,omitempty" yaml:"url,omitempty"`
}

type NotebookSlide struct {
	Name   string `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string `json:"prompt,omitempty" yaml:"prompt,omitempty"`
}

type NotebookPodcast struct {
	Name   string   `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string   `json:"prompt,omitempty" yaml:"prompt,omitempty"`
	Voices []string `json:"voices,omitempty" yaml:"voices,omitempty"`
}

type NotebookReport struct {
	Name   string `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string `json:"prompt,omitempty" yaml:"prompt,omitempty"`
}

type NotebookInfographic struct {
	Name   string `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string `json:"prompt,omitempty" yaml:"prompt,omitempty"`
}

type NotebookProcess struct {
	Name   string `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string `json:"prompt,omitempty" yaml:"prompt,omitempty"`
}

type NotebookArchitecture struct {
	Name   string `json:"name,omitempty" yaml:"name,omitempty"`
	Prompt string `json:"prompt,omitempty" yaml:"prompt,omitempty"`
}

type Bridge struct {
	URL string `json:"url,omitempty" yaml:"url,omitempty"`
}

type Drive struct {
	ID   string `json:"id,omitempty" yaml:"id,omitempty"`
	Type string `json:"-" yaml:"type,omitempty"`
	Name string `json:"name,omitempty" yaml:"name,omitempty"`
	Path string `json:"-" yaml:"path,omitempty"`
	URL  string `json:"-" yaml:"url,omitempty"`
	Icon string `json:"icon,omitempty" yaml:"icon,omitempty"`

	Auth *DriveAuth `json:"-" yaml:"auth,omitempty"`
}

type DriveAuth struct {
	Issuer       string `json:"-" yaml:"issuer,omitempty"`
	ClientID     string `json:"-" yaml:"client_id,omitempty"`
	ClientSecret string `json:"-" yaml:"client_secret,omitempty"`
	Scope        string `json:"-" yaml:"scope,omitempty"`
}
