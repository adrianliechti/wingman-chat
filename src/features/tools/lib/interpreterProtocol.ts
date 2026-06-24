/**
 * Message protocol between the main thread and the Pyodide interpreter worker.
 *
 * Python execution runs in a dedicated module worker so CPU-bound code (e.g.
 * pdfplumber over a large PDF) cannot freeze the UI thread. Some capabilities
 * still require the main thread, so the worker calls back over RPC:
 *   - the `llm(...)` Python global — needs the chat client/config
 *   - the `ocr(...)` Python global — needs the chat client/config
 *   - the `vision(...)` Python global — needs the chat client/config
 *   - the `render(...)` Python global — needs the chat client/config
 *   - the `synthesize(...)` Python global — needs the chat client/config
 *   - the `transcribe(...)` Python global — needs the chat client/config
 *   - the `translate(...)` Python global — needs the chat client/config
 *   - Plotly figure rendering — plotly.js requires a real DOM
 */

export interface ArtifactFile {
  content: string;
  contentType?: string;
}

export type ArtifactFiles = Record<string, ArtifactFile>;

export interface CodeExecutionRequest {
  code: string;
  packages?: string[];
  files?: ArtifactFiles;
}

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  files?: ArtifactFiles;
}

export type ExecuteReply = { type: "started" } | { type: "result"; result: CodeExecutionResult };

/** Render request written by plotlyShim.py into the in-FS render queue. */
export interface PlotlyManifest {
  fig: { data: unknown[]; layout?: Record<string, unknown>; config?: Record<string, unknown> };
  file: string;
  format: string;
  width: number | null;
  height: number | null;
  scale: number | null;
}

export interface PlotlyResult {
  path: string;
  /** Binary image bytes, or SVG markup as text. */
  data: Uint8Array | string;
}

/** Input image for the `render` helper — bytes plus the path whose basename routes the upload by format. */
export interface RenderInput {
  data: Uint8Array;
  path: string;
}

/**
 * Per-call options for the `llm` helper. Everything is optional — `model`
 * falls back to the model currently selected in the chat.
 */
export interface LlmCallOptions {
  model?: string;
  system?: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

// Every request carries a dedicated MessagePort for its reply, so no id
// bookkeeping is needed on either side; worker→main RPC replies use the
// `RpcReply` envelope below.
export interface ExecuteMessage {
  type: "execute";
  request: CodeExecutionRequest;
  port: MessagePort;
}

export type WorkerToMainMessage =
  | { type: "llm-request"; prompt: string; options?: LlmCallOptions; port: MessagePort }
  // Document bytes read from the worker FS, extracted on the main thread via
  // the backend extractor service; the basename of `path` lets it route by format.
  | { type: "ocr-request"; data: Uint8Array; path: string; port: MessagePort }
  // Image bytes read from the worker FS, analyzed on the main thread via a
  // vision-capable chat model.
  | { type: "vision-request"; data: Uint8Array; path: string; prompt?: string; port: MessagePort }
  // Image generation/editing via the backend renderer service; replies with
  // the image bytes, which the worker writes to the requested output path.
  | { type: "render-request"; prompt: string; inputs: RenderInput[]; port: MessagePort }
  // Text-to-speech via the backend; replies with the WAV bytes, which the
  // worker writes to the requested output path.
  | { type: "synthesize-request"; text: string; voice?: string; port: MessagePort }
  // Audio bytes read from the worker FS, transcribed on the main thread via
  // the backend speech-to-text service.
  | { type: "transcribe-request"; data: Uint8Array; path: string; port: MessagePort }
  // Text translated on the main thread via the backend translation service.
  | { type: "translate-text-request"; lang: string; text: string; port: MessagePort }
  // File bytes read from the worker FS, translated on the main thread; replies
  // with the translated file bytes, which the worker writes to the output path.
  | { type: "translate-file-request"; lang: string; data: Uint8Array; path: string; port: MessagePort }
  // `plotlyJs` carries the plotly.js source (read from the wheel inside the
  // worker's FS) on the first render request; the main thread caches the
  // loaded script, so subsequent requests omit it.
  | { type: "plotly-request"; manifests: PlotlyManifest[]; plotlyJs?: string; port: MessagePort };

export type RpcReply = { ok: true; value: unknown } | { ok: false; error: string };
