/**
 * Message protocol between the main thread and the Pyodide interpreter worker.
 * Some Python globals (llm/ocr/vision/render/synthesize/transcribe/translate)
 * need the main thread, so the worker calls back over RPC.
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

/** Input image for the `render` helper — bytes plus the path whose basename routes the upload by format. */
export interface RenderInput {
  data: Uint8Array;
  path: string;
}

/** Per-call options for the `llm` helper; `model` falls back to the chat's currently selected model. */
export interface LlmCallOptions {
  model?: string;
  system?: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

// Every request carries a dedicated MessagePort for its reply, so no id
// bookkeeping is needed on either side.
export interface ExecuteMessage {
  type: "execute";
  request: CodeExecutionRequest;
  port: MessagePort;
}

export type WorkerToMainMessage =
  | { type: "llm-request"; prompt: string; options?: LlmCallOptions; port: MessagePort }
  | { type: "ocr-request"; data: Uint8Array; path: string; port: MessagePort }
  | { type: "vision-request"; data: Uint8Array; path: string; prompt?: string; port: MessagePort }
  | { type: "render-request"; prompt: string; inputs: RenderInput[]; port: MessagePort }
  | { type: "synthesize-request"; text: string; voice?: string; port: MessagePort }
  | { type: "transcribe-request"; data: Uint8Array; path: string; port: MessagePort }
  | { type: "translate-text-request"; lang: string; text: string; port: MessagePort }
  | { type: "translate-file-request"; lang: string; data: Uint8Array; path: string; port: MessagePort };

export type RpcReply = { ok: true; value: unknown } | { ok: false; error: string };
