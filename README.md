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

- **In-browser code interpreters** — sandboxed Python (Pyodide) and JavaScript workers with bundled
  data, document and media libraries. The model writes and runs real code; charts, files, and results
  land back in the workspace.
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

### Data analysis & workflows

Python includes DuckDB, pandas and PyArrow for local analysis and file generation. JavaScript exposes
Apache Arrow as the `arrow` global. Both interpreters can also query saved workspace files through
`await sql(...)`; HTML previews use `wingman.duckdb`. Libraries load on demand from the bundled assets.

| Capability                                 | Python interpreter                                | JavaScript interpreter                               | HTML preview                                      |
| ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| SQL over CSV/TSV, JSON/JSONL and Parquet   | Local `duckdb`, or `await sql(...)` bridge        | `await sql(...)` bridge                              | `wingman.duckdb.query(...)`                       |
| Query pandas / Arrow objects               | Register them with a local DuckDB connection      | Write an Arrow IPC file for Python                   | Query prepared workspace datasets                 |
| Read/write Arrow IPC files                 | `pyarrow.ipc`                                     | `arrow.tableFromIPC` / `arrow.tableToIPC` with `vfs` | Use Parquet for SQL dashboards                    |
| Write Parquet datasets                     | DuckDB `COPY` or `pyarrow.parquet`                | Hand off to Python                                   | Consume generated datasets                        |
| Write CSV / JSON                           | DuckDB `COPY`, pandas or standard library         | `vfs.write` / `vfs.writeJSON`                        | Consume generated datasets                        |
| Read Excel                                 | pandas/openpyxl; bridge also supports `read_xlsx` | Bridge `read_xlsx`                                   | Bridge `read_xlsx`                                |
| Query files created during the current run | Local DuckDB reads them immediately               | Bridge sees them after a successful run              | Sees committed workspace files                    |
| Save a database for later runs             | `duckdb.connect("analysis.duckdb")`               | Preserve/download the binary file                    | No `.duckdb` data viewer                          |
| Interactive filtered dashboards            | Prepare data and statistical results              | Generate charts and HTML                             | Query current workspace data for each filter/view |

Use **Parquet to hand datasets between Python, the SQL bridge and HTML dashboards**. Use Arrow IPC
when exchanging typed tables between Python and JavaScript. SQL sessions are separate: local Python
tables and bridge tables are not shared, and temporary tables end with their run or preview session.

Python's DuckDB wheel includes `core_functions`, `icu`, `json` and `parquet`; Excel and full-text-search
extensions are available through the bridge, not the Python wheel. Local DuckDB connections default
to one thread and a 256 MB buffer-memory limit. This is not a limit on all Python, Arrow or result
memory: use `COPY` or `to_arrow_reader()` for larger results; `df()` and `to_arrow_table()` materialize
them. Bridge JSON results are capped at 100,000 rows / 16 MiB. Interpreter file/output limits also apply.

Successful interpreter runs commit file changes to the workspace; failed or cancelled runs do not.
Close database connections before finishing (prefer `with duckdb.connect(...) as con:`). The runtime
also closes connections opened through `duckdb.connect` and resets the default connection per run.
Database revisions store whole changed files, so Parquet outputs are usually preferable to frequent
updates of a growing database. Direct networking and runtime package installation are unavailable.

Example requests:

- **Sales dashboard:** “Join these monthly CSVs, normalize regions, save a Parquet dataset, and build
  a dashboard with date and region filters.”
- **Reconciliation:** “Compare the invoice spreadsheet with payment exports; give me unmatched
  records, duplicate IDs and a downloadable exception report.”
- **Event analysis:** “Read these gzipped JSONL logs, calculate funnel conversion and session counts,
  and save the results with charts.”
- **Data quality:** “Profile missing values, invalid dates and outliers; produce a cleaned dataset
  and an audit report explaining every rule.”
- **Typed data exchange:** “Generate a table in Python, save Arrow IPC, and use JavaScript to build
  a visualization without losing large integer IDs.”

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
| Code execution | Python/Pyodide + DuckDB/PyArrow; JavaScript workers + Arrow; DuckDB-Wasm preview bridge     |
| Server         | Go — static hosting, API proxy, skills library, drive providers, OpenTelemetry              |
| Packaging      | Multi-stage Docker image (`ghcr.io/adrianliechti/wingman-chat`)                             |

The Go server (`main.go`, `pkg/`) serves the built SPA from `dist/`, proxies requests under the API
prefix (default `/api`) to the configured platform, and mounts the `skills/` directory as a library
the client can read.

Production builds generate Brotli and gzip variants of WASM, JavaScript, CSS, HTML, and other text
assets. The Go server negotiates the encoding and serves those files directly, with no compression
work during requests. Hot files use the OS page cache rather than a separate Go memory cache.
Hashed assets keep their one-year immutable browser cache; other files revalidate on reuse.

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- Go 1.x (only to run the server locally)
- Access to a Wingman or OpenAI-compatible API endpoint

### Development

```bash
npm install

# Point at your platform
export WINGMAN_URL=http://localhost:4242      # or OPENAI_BASE_URL
export WINGMAN_TOKEN=...                      # or OPENAI_API_KEY

# Frontend dev server (bundles Pyodide packages on first run)
npm run dev
```

### Gateway end-to-end tests

The opt-in E2E suites start the application development proxy and run the real `Client` and agent loop against a live
Wingman gateway. The smoke suite covers model discovery, Responses streaming, tool-call correlation, cancellation, the
terminal error contract, and a Sonnet 4.6 artifact create/validate/reference flow.

The challenge suite uses the machine's existing `WINGMAN_URL` and `WINGMAN_TOKEN`. It prefers Bedrock Sonnet 4.6 when
that gateway exposes it (otherwise direct Sonnet 4.6) and also runs GPT-5.4. It injects a real mid-stream connection
failure, checks transport retry and retry cancellation, exercises transient tool recovery, runtime verification,
nested-agent budgets, running-tool aborts and runaway-loop limits, and executes quote-heavy multiline Python through
the exact production interpreter schema. Its artifact scenarios use production file tools against an isolated disk
workspace to cover invalid structured-file repair, revision/delta metadata, multi-file manifests, and moves. It makes
many real model requests and requires `python3`; use the smoke suite for
quick checks.

The Bedrock soak is a focused provider-quality probe: ten byte-exact `create_file` calls and ten real
`execute_python_code` calls using the production schemas. It reports raw JSON/AntML failures separately from calls
that succeeded through client-side recovery, which makes gateway/model improvements measurable rather than hidden by
the workaround.

```bash
npm run test:e2e
npm run test:e2e:challenge
npm run test:e2e:bedrock-soak
npm run test:e2e:all

# Optional overrides
WINGMAN_E2E_GATEWAY=http://localhost:4242 \
WINGMAN_E2E_MODEL=auto \
WINGMAN_E2E_ARTIFACT_MODEL=claude-sonnet-4-6 \
WINGMAN_E2E_CHALLENGE_MODELS=bedrock-sonnet-4-6,gpt-5.4 \
WINGMAN_E2E_BEDROCK_MODEL=bedrock-sonnet-4-6 \
WINGMAN_E2E_PYTHON=python3 \
WINGMAN_E2E_TIMEOUT_MS=90000 \
WINGMAN_TOKEN=... \
npm run test:e2e:challenge
```

To run the Go server against the built frontend:

```bash
npm run build
PORT=8080 PREFIX=/ WINGMAN_URL=http://localhost:4242 go run .
# or: task serve
```

### Docker

```bash
docker build -t wingman-chat .
docker run -it --rm -p 8000:8000 \
  -e WINGMAN_URL=http://host.docker.internal:4242 \
  wingman-chat
# or: task run
```

## Configuration

Wingman is configured through environment variables, YAML files, and a runtime `public/config.json`.

**Connection**

- `WINGMAN_URL` / `OPENAI_BASE_URL` — platform API base URL (required)
- `WINGMAN_TOKEN` / `OPENAI_API_KEY` — API token
- `PORT` (default `8000`), `PREFIX` (default `/api`)
- `SKILLS_PATH` (default `skills`)

**Branding**

- `TITLE`, `DISCLAIMER`, `SUPPORT_URL`, `BRIDGE_URL`

**Plugin hub**

- `PLUGINS_URL` — base URL of a [plugin-hub](https://agent-plugins.org) instance. When set, a "Hub" tab
  appears in the Skill Catalog for browsing and installing its plugins' skills into your local
  skill library. Only skills are installed; any `mcp_servers` a plugin declares are shown for
  information only. Supports both Agent Plugin archives (`skills/{name}/SKILL.md`) and standalone
  skill-folder archives (`SKILL.md` at the archive root).

**Feature flags** (set to `true` to enable; most accept companion `*_MODEL` overrides)

- `VISION_ENABLED`, `VOICE_ENABLED`, `TTS_ENABLED`, `STT_ENABLED`
- `INTERNET_ENABLED` (`INTERNET_SEARCHER`, `INTERNET_SCRAPER`, `INTERNET_RESEARCHER`, `INTERNET_ELICITATION`)
- `RENDERER_ENABLED`, `ARTIFACTS_ENABLED`, `REPOSITORY_ENABLED`, `MEMORY_ENABLED`
- `EXTRACTOR_ENABLED`, `TRANSLATOR_ENABLED`, `TELEMETRY_ENABLED`
- `CHAT_RETENTION_DAYS`, `CHAT_INSTRUCTIONS`, `CHAT_SUMMARIZER`, `CHAT_OPTIMIZER`
- `CHAT_COMPACTION_ENABLED` (`CHAT_COMPACTION_THRESHOLD` — deployment-wide ceiling on the estimated-token budget before older turns are summarized; per-model/family values apply below it)

YAML files loaded from the working directory (when present) configure models, tools, drives,
backgrounds, and per-feature settings: `models.yaml`, `tools.yaml`, `drives.yaml`,
`backgrounds.yaml`, `chat.yaml`, `translator.yaml`, `vision.yaml`, `text.yaml`,
`extractor.yaml`, `internet.yaml`, `renderer.yaml`, `repository.yaml`.
