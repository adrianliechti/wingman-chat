/**
 * Message protocol between the main thread and the Pyodide interpreter worker.
 *
 * Python execution runs in a dedicated module worker so CPU-bound code (e.g.
 * pdfplumber over a large PDF) cannot freeze the UI thread. Two capabilities
 * still require the main thread, so the worker calls back over RPC:
 *   - the `llm(...)` Python global — needs the chat client/config
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

/** Render request written by plotlyShim.py into the in-FS render queue. */
export interface PlotlyRenderManifest {
  fig: { data: unknown[]; layout?: Record<string, unknown>; config?: Record<string, unknown> };
  file: string;
  format: string;
  width: number | null;
  height: number | null;
  scale: number | null;
}

export interface PlotlyRenderResult {
  path: string;
  /** Binary image bytes, or SVG markup as text. */
  data: Uint8Array | string;
}

/**
 * Per-call options for the `llm` helper. Everything is optional — `model`
 * falls back to the model currently selected in the chat.
 */
export interface LlmCallOptions {
  model?: string;
  system?: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high";
}

// Every request carries a dedicated MessagePort for its reply, so no id
// bookkeeping is needed on either side. Execute replies are a bare
// `CodeExecutionResult` (it has its own success/error shape and never
// rejects); worker→main RPC replies use the `RpcReply` envelope below.
export interface ExecuteMessage {
  type: "execute";
  request: CodeExecutionRequest;
  port: MessagePort;
}

export type WorkerToMainMessage =
  | { type: "llm-request"; prompt: string; options?: LlmCallOptions; port: MessagePort }
  // `plotlyJs` carries the plotly.js source (read from the wheel inside the
  // worker's FS) on the first render request; the main thread caches the
  // loaded script, so subsequent requests omit it.
  | { type: "render-request"; manifests: PlotlyRenderManifest[]; plotlyJs?: string; port: MessagePort };

export type RpcReply = { ok: true; value: unknown } | { ok: false; error: string };
