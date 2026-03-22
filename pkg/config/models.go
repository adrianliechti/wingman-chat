package config

type Config struct {
	Title      string   `json:"title,omitempty" yaml:"title,omitempty"`
	Disclaimer string   `json:"disclaimer,omitempty" yaml:"disclaimer,omitempty"`
	Support    *Support `json:"support,omitempty" yaml:"support,omitempty"`

	Tools  []Tool  `json:"tools,omitempty" yaml:"tools,omitempty"`
	Models []Model `json:"models,omitempty" yaml:"models,omitempty"`

	TTS *TTS `json:"tts,omitempty" yaml:"tts,omitempty"`
	STT *STT `json:"stt,omitempty" yaml:"stt,omitempty"`

	Voice     *Voice     `json:"voice,omitempty" yaml:"voice,omitempty"`
	Vision    *Vision    `json:"vision,omitempty" yaml:"vision,omitempty"`
	Text      *Text      `json:"text,omitempty" yaml:"text,omitempty"`
	Extractor *Extractor `json:"extractor,omitempty" yaml:"extractor,omitempty"`

	Internet *Internet `json:"internet,omitempty" yaml:"internet,omitempty"`
	Renderer *Renderer `json:"renderer,omitempty" yaml:"renderer,omitempty"`

	Artifacts  *Artifacts  `json:"artifacts,omitempty" yaml:"artifacts,omitempty"`
	Repository *Repository `json:"repository,omitempty" yaml:"repository,omitempty"`

	Workflow   *Workflow   `json:"workflow,omitempty" yaml:"workflow,omitempty"`
	Memory     *Memory     `json:"memory,omitempty" yaml:"memory,omitempty"`
	Researcher *Researcher `json:"researcher,omitempty" yaml:"researcher,omitempty"`
	Translator *Translator `json:"translator,omitempty" yaml:"translator,omitempty"`

	Chat *Chat `json:"chat,omitempty" yaml:"chat,omitempty"`

	Backgrounds map[string][]Background `json:"backgrounds,omitempty" yaml:"backgrounds,omitempty"`
}

type Support struct {
	URL   string `json:"url,omitempty" yaml:"url,omitempty"`
	Email string `json:"email,omitempty" yaml:"email,omitempty"`
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
	ID          string      `json:"id,omitempty" yaml:"id,omitempty"`
	Name        string      `json:"name,omitempty" yaml:"name,omitempty"`
	Description string      `json:"description,omitempty" yaml:"description,omitempty"`
	Effort      string      `json:"effort,omitempty" yaml:"effort,omitempty"`
	Summary     string      `json:"summary,omitempty" yaml:"summary,omitempty"`
	Verbosity   string      `json:"verbosity,omitempty" yaml:"verbosity,omitempty"`
	Tools       *ModelTools `json:"tools,omitempty" yaml:"tools,omitempty"`
	Prompts     []string    `json:"prompts,omitempty" yaml:"prompts,omitempty"`
}

type TTS struct {
	Model string `json:"model,omitempty" yaml:"model,omitempty"`
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
type Workflow struct{}
type Memory struct{}

type Repository struct {
	Embedder     string `json:"embedder,omitempty" yaml:"embedder,omitempty"`
	Extractor    string `json:"extractor,omitempty" yaml:"extractor,omitempty"`
	ContextPages *int   `json:"context_pages,omitempty" yaml:"context_pages,omitempty"`
}

type Researcher struct {
	Model string `json:"model,omitempty" yaml:"model,omitempty"`
}

type Chat struct {
	RetentionDays *int `json:"retentionDays,omitempty" yaml:"retentionDays,omitempty"`
}

type Translator struct {
	Model     string   `json:"model,omitempty" yaml:"model,omitempty"`
	Files     []string `json:"files,omitempty" yaml:"files,omitempty"`
	Languages []string `json:"languages,omitempty" yaml:"languages,omitempty"`
}

type Background struct {
	URL string `json:"url,omitempty" yaml:"url,omitempty"`
}
