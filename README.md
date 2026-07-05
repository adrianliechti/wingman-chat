# Wingman Chat

A modern, self-hostable web client for AI chat and content creation. Wingman Chat connects to any
[Wingman](https://github.com/adrianliechti/wingman) or OpenAI-compatible platform and turns it into a
full workspace — multi-model chat, an in-browser code interpreter, document & media generation, voice
conversations, retrieval over your own files, and a library of reusable skills.

## Features

### Chat

- **Multi-model chat** with configurable models, system instructions, and per-model defaults.
- **Rich Markdown rendering** — GitHub-flavored Markdown, syntax highlighting (Shiki), math (KaTeX),
  Mermaid diagrams, emoji, and tables.
- **Conversation management** with optional retention, automatic summarization, and history
  optimization.
- **Attachments & vision** — drop in images and documents; PDF/Office files are extracted to text.
- **Screen capture** to share what you're looking at with the model.

### Tools & Agents

- **In-browser code interpreter** — a sandboxed Python runtime (Pyodide) with bundled scientific
  packages. The model writes and runs real code; charts, files, and results land back in the chat.
- **Web search & browsing** for grounded, up-to-date answers.
- **Sub-agents** for delegating focused, multi-step work.
- **Model Context Protocol (MCP)** — connect external tool servers through a configurable bridge.
- **Built-in tool shims** for OCR, vision, translation, transcription, speech synthesis, and rendering.

### Studio — documents, visuals & media

Ask for a real deliverable and Wingman builds it for real, then drops it in your workspace:

- **Slide decks** (`.pptx`), **Word documents** (`.docx`), **spreadsheets** (`.xlsx`), and **PDFs**.
- **Charts, dashboards, and data visualizations** built from real numbers.
- **Diagrams** — BPMN, swimlane, C4, sequence, mind maps, and other process/architecture diagrams.
- **Infographics, posters, and generative/algorithmic art** across many visual styles.
- **Self-contained web pages / UI prototypes** (offline-ready, no external CDNs).
- **Generated images** (when an image tool is configured) and **podcast-style audio**.

### Artifacts workspace

A per-conversation file system where generated and uploaded files live, with native in-app rendering
and download. Browse, preview, and iterate on artifacts side-by-side with the chat.

### Notebook

Turn source material into polished, long-form output: **reports**, **slide decks**, **infographics**,
**podcasts** (briefing, debate, deep-dive, overview, story formats).
**quizzes**, **mind maps**, and **podcasts** (briefing, debate, deep-dive, overview, story formats).

### Repository (retrieval)

Upload files into a repository; Wingman extracts and embeds them so the model can answer questions
grounded in your own documents.

### Voice

Real-time voice conversations with configurable speech-to-text, text-to-speech, and voice models,
including live transcription.

### Translate

A dedicated mode for translating documents (PDF and more) and text, with selectable tone and style
across many languages.

### Canvas

A focused surface for generating and iterating on images.

### Skills library

100+ reusable, domain-specific skills the model can read on demand — spanning engineering, product,
design, data, finance, legal, HR, marketing, sales, operations, customer support, knowledge, writing,
and the Studio output formats. Skills are plain Markdown, so they're easy to add, edit, and share.

### Cloud drives

Optional integrations to bring in documents from **OneDrive**, **SharePoint** (via Microsoft Graph),
or a **local** directory.

### Platform & UX

- **Themes** (light / dark) with configurable backgrounds, and a PWA-capable install.
- **Memory** for retaining context across conversations (when enabled).
- **OpenTelemetry** traces, metrics, and logs for observability.
- **Feature flags** — every capability above can be turned on or off per deployment.

## Architecture

| Layer          | Stack                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| Frontend       | React 19, TypeScript, Vite 8, Tailwind CSS 4, TanStack Router/Table/Virtual, React Compiler |
| Code execution | Pyodide (Python in WebAssembly), bundled at build time                                      |
| Server         | Go — static hosting, API proxy, skills/notebook libraries, drive providers, OpenTelemetry   |
| Packaging      | Multi-stage Docker image (`ghcr.io/adrianliechti/wingman-chat`)                             |

The Go server (`main.go`, `pkg/`) serves the built SPA from `dist/`, proxies requests under the API
prefix (default `/api`) to the configured platform, and mounts the `skills/` and `notebook/`
directories as libraries the client can read.

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- Go 1.x (only to run the server locally)
- Access to a Wingman or OpenAI-compatible API endpoint

### Development

```bash
npm install

# Point at your platform
export WINGMAN_URL=http://localhost:8080      # or OPENAI_BASE_URL
export WINGMAN_TOKEN=...                      # or OPENAI_API_KEY

# Frontend dev server (bundles Pyodide packages on first run)
npm run dev
```

To run the Go server against the built frontend:

```bash
npm run build
PORT=8080 PREFIX=/ WINGMAN_URL=http://localhost:8080 go run .
# or: task serve
```

### Docker

```bash
docker build -t wingman-chat .
docker run -it --rm -p 8000:8000 \
  -e WINGMAN_URL=http://host.docker.internal:8080 \
  wingman-chat
# or: task run
```

## Configuration

Wingman is configured through environment variables, YAML files, and a runtime `public/config.json`.

**Connection**

- `WINGMAN_URL` / `OPENAI_BASE_URL` — platform API base URL (required)
- `WINGMAN_TOKEN` / `OPENAI_API_KEY` — API token
- `PORT` (default `8000`), `PREFIX` (default `/api`)
- `SKILLS_PATH` (default `skills`), `NOTEBOOKS_PATH` (default `notebook`)

**Branding**

- `TITLE`, `DISCLAIMER`, `SUPPORT_URL`, `BRIDGE_URL`

**Feature flags** (set to `true` to enable; most accept companion `*_MODEL` overrides)

- `VISION_ENABLED`, `VOICE_ENABLED`, `TTS_ENABLED`, `STT_ENABLED`
- `INTERNET_ENABLED` (`INTERNET_SEARCHER`, `INTERNET_SCRAPER`, `INTERNET_RESEARCHER`, `INTERNET_ELICITATION`)
- `RENDERER_ENABLED`, `ARTIFACTS_ENABLED`, `REPOSITORY_ENABLED`, `MEMORY_ENABLED`
- `NOTEBOOK_ENABLED`, `EXTRACTOR_ENABLED`, `TRANSLATOR_ENABLED`, `TELEMETRY_ENABLED`
- `CHAT_RETENTION_DAYS`, `CHAT_INSTRUCTIONS`, `CHAT_SUMMARIZER`, `CHAT_OPTIMIZER`
- `CHAT_COMPACTION_ENABLED` (`CHAT_COMPACTION_THRESHOLD` — deployment-wide ceiling on the estimated-token budget before older turns are summarized; per-model/family values apply below it)

YAML files loaded from the working directory (when present) configure models, tools, drives,
backgrounds, and per-feature settings: `models.yaml`, `tools.yaml`, `drives.yaml`,
`backgrounds.yaml`, `chat.yaml`, `notebook.yaml`, `translator.yaml`, `vision.yaml`, `text.yaml`,
`extractor.yaml`, `internet.yaml`, `renderer.yaml`, `repository.yaml`.
