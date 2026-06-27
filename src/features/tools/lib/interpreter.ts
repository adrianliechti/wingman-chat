/**
 * Main-thread client for the Pyodide interpreter worker.
 *
 * Python runs in a dedicated module worker (`interpreter.worker.ts`) so
 * CPU-bound code cannot freeze the UI — module workers are supported by all
 * recent Edge and Safari (incl. iOS) versions. The shared worker lifecycle
 * (stall watchdog, abort, crash recovery, RPC plumbing) lives in
 * `workerHost.ts`; this file supplies only the Pyodide-specific bits: the
 * worker factory and the dispatcher for capabilities that need the main thread
 * (the `llm`/`ocr`/`vision`/`render`/`synthesize`/`transcribe`/`translate`
 * Python globals).
 *
 * Each request carries its own MessagePort for the reply (see
 * interpreterProtocol.ts), so there is no id correlation in either direction.
 */

import type { CodeExecutionRequest, CodeExecutionResult, WorkerToMainMessage } from "./interpreterProtocol";
import { runLlm } from "./llmCommand";
import { runOcr } from "./ocrCommand";
import { runRenderImage } from "./renderCommand";
import { runSynthesize } from "./synthesizeCommand";
import { runTranscribe } from "./transcribeCommand";
import { runTranslateFile, runTranslateText } from "./translateCommand";
import { runVision } from "./visionCommand";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";

export type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";

// Dispatch a worker→main RPC to the runner that owns it. The resolved value is
// posted back to the worker on the request's reply port by the host.
function handleMessage(message: WorkerToMainMessage): Promise<unknown> {
  switch (message.type) {
    case "llm-request":
      return runLlm(message.prompt, message.options);
    case "ocr-request":
      return runOcr(message.data, message.path);
    case "vision-request":
      return runVision(message.data, message.path, message.prompt);
    case "render-request":
      return runRenderImage(message.prompt, message.inputs);
    case "synthesize-request":
      return runSynthesize(message.text, message.voice);
    case "transcribe-request":
      return runTranscribe(message.data, message.path);
    case "translate-text-request":
      return runTranslateText(message.lang, message.text);
    case "translate-file-request":
      return runTranslateFile(message.lang, message.data, message.path);
  }
}

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./interpreter.worker.ts", import.meta.url), { type: "module" }),
  handleMessage,
  crashMessage: "Python interpreter worker crashed",
});

export function executeCode(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
  return host.execute(request, options);
}
