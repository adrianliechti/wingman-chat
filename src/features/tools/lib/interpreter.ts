/**
 * Main-thread client for the Pyodide interpreter worker.
 *
 * Python runs in a dedicated module worker (`interpreter.worker.ts`) so
 * CPU-bound code cannot freeze the UI — module workers are supported by all
 * recent Edge and Safari (incl. iOS) versions. This side keeps the public
 * `executeCode` API and answers the worker's RPCs for capabilities that need
 * the main thread: the `llm` Python global and Plotly DOM rendering.
 *
 * Each request carries its own MessagePort for the reply (see
 * interpreterProtocol.ts), so there is no id correlation in either direction.
 */

import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";
import { runLlm } from "./llmCommand";
import { runOcr } from "./ocrCommand";
import { renderPlotlyFigures } from "./plotlyRenderer";
import { runRenderImage } from "./renderCommand";
import { runSynthesize } from "./synthesizeCommand";
import { runTranscribe } from "./transcribeCommand";
import { runTranslateFile, runTranslateText } from "./translateCommand";
import { runVision } from "./visionCommand";

export type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";

let worker: Worker | null = null;

// Outstanding execution rejects — fired if the worker dies so callers don't
// hang on reply ports that will never receive a message.
const pendingRejects = new Set<(error: Error) => void>();

async function replyOnPort(port: MessagePort, run: () => Promise<unknown>): Promise<void> {
  let reply: RpcReply;
  try {
    reply = { ok: true, value: await run() };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(reply);
  port.close();
}

function getWorker(): Worker {
  if (!worker) {
    const created = new Worker(new URL("./interpreter.worker.ts", import.meta.url), { type: "module" });
    created.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
      const message = event.data;
      if (message.type === "llm-request") {
        void replyOnPort(message.port, () => runLlm(message.prompt, message.options));
      } else if (message.type === "ocr-request") {
        void replyOnPort(message.port, () => runOcr(message.data, message.path));
      } else if (message.type === "vision-request") {
        void replyOnPort(message.port, () => runVision(message.data, message.path, message.prompt));
      } else if (message.type === "render-request") {
        void replyOnPort(message.port, () => runRenderImage(message.prompt, message.inputs));
      } else if (message.type === "synthesize-request") {
        void replyOnPort(message.port, () => runSynthesize(message.text, message.voice));
      } else if (message.type === "transcribe-request") {
        void replyOnPort(message.port, () => runTranscribe(message.data, message.path));
      } else if (message.type === "translate-text-request") {
        void replyOnPort(message.port, () => runTranslateText(message.lang, message.text));
      } else if (message.type === "translate-file-request") {
        void replyOnPort(message.port, () => runTranslateFile(message.lang, message.data, message.path));
      } else {
        void replyOnPort(message.port, () => renderPlotlyFigures(message.manifests, message.plotlyJs));
      }
    });
    created.addEventListener("error", (event) => {
      // The worker script failed to load or died on an uncaught error. Drop it
      // so the next call spawns a fresh one (which rebuilds Pyodide state).
      console.error("Interpreter worker error:", event.message || event);
      if (worker === created) worker = null;
      created.terminate();
      const error = new Error(event.message || "Python interpreter worker crashed");
      for (const reject of pendingRejects) reject(error);
      pendingRejects.clear();
    });
    worker = created;
  }
  return worker;
}

export async function executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
  let pendingReject: ((error: Error) => void) | null = null;
  try {
    const target = getWorker();
    return await new Promise<CodeExecutionResult>((resolve, reject) => {
      pendingReject = reject;
      pendingRejects.add(reject);
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (event: MessageEvent<CodeExecutionResult>) => {
        port1.close();
        resolve(event.data);
      };
      target.postMessage({ type: "execute", request, port: port2 } satisfies ExecuteMessage, [port2]);
    });
  } catch (error) {
    console.error("Code execution error:", error);
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (pendingReject) pendingRejects.delete(pendingReject);
  }
}
