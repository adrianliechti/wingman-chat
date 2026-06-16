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

// Each in-flight execution registers a "worker died" callback so it settles with
// an error instead of hanging on a reply port that will never arrive.
const pendingFailures = new Set<() => void>();

// The in-flight execution's stall watchdog. The bridge-request handler pauses it
// while the worker is blocked on a main-thread RPC (those round trips are bounded
// separately). Only one execution runs at a time — the sandbox lock serializes
// them — so a single slot suffices.
let activeBridge: { enter: () => void; leave: () => void } | null = null;

async function replyOnPort(port: MessagePort, run: () => Promise<unknown>): Promise<void> {
  // A bridge call means the worker is waiting on us, not stalled — pause its
  // stall timer while it's in flight. Capture the slot now so a reply that lands
  // after the run was torn down can't disturb whatever runs next.
  const bridge = activeBridge;
  bridge?.enter();
  let reply: RpcReply;
  try {
    reply = { ok: true, value: await run() };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    bridge?.leave();
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
      for (const onCrash of pendingFailures) onCrash();
      pendingFailures.clear();
    });
    worker = created;
  }
  return worker;
}

/** How long the worker may run *pure compute* with no progress before it's
 * treated as wedged (infinite loop / hang) and force-terminated. Bridge calls
 * (render/synthesize/…) pause this — they're bounded by their own network
 * timeout — so a legitimately slow render or a multi-segment podcast is never
 * killed, while an infinite loop recovers in ~this long instead of minutes. */
const COMPUTE_STALL_MS = 120_000;

export interface ExecuteCodeOptions {
  /** Aborts the run (e.g. the user's Stop): terminates the worker and settles. */
  signal?: AbortSignal;
  /** Override the compute-stall ceiling. */
  timeoutMs?: number;
}

export async function executeCode(
  request: CodeExecutionRequest,
  options?: ExecuteCodeOptions,
): Promise<CodeExecutionResult> {
  const stallMs = options?.timeoutMs ?? COMPUTE_STALL_MS;
  const signal = options?.signal;

  let target: Worker;
  try {
    target = getWorker();
  } catch (error) {
    return { success: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }

  // Every termination path (result, stall, abort, crash) funnels through a single
  // `settle`; `fail` is settle-with-error and also tears down the wedged worker.
  return new Promise<CodeExecutionResult>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = 0;
    let settled = false;

    // A wedged run can't be interrupted in single-threaded Pyodide, so tear the
    // worker down: the next call spawns a fresh one, and settling here releases
    // the caller's sandbox lock instead of blocking every queued execution.
    const fail = (error: string) => {
      if (worker === target) worker = null;
      target.terminate();
      settle({ success: false, output: "", error });
    };
    // (Re)arm the stall timer; runs only while no bridge call is in flight, so it
    // measures uninterrupted pure-compute time, not total wall-clock.
    const arm = () => {
      if (settled || stallMs <= 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => fail(`Code execution stalled — no progress for ${Math.round(stallMs / 1000)}s (worker terminated)`),
        stallMs,
      );
    };
    const bridge = {
      enter: () => {
        inFlight++;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      leave: () => {
        if (--inFlight <= 0) arm();
      },
    };
    const onCrash = () => fail("Python interpreter worker crashed");
    const onAbort = () => fail("Code execution aborted");

    function settle(result: CodeExecutionResult) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeBridge === bridge) activeBridge = null; // only the owner clears the shared slot
      pendingFailures.delete(onCrash);
      signal?.removeEventListener("abort", onAbort);
      port1.close();
      resolve(result);
    }

    port1.onmessage = (event: MessageEvent<CodeExecutionResult>) => settle(event.data);
    pendingFailures.add(onCrash);
    if (signal) {
      if (signal.aborted) {
        fail("Code execution aborted");
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    activeBridge = bridge;
    arm();
    target.postMessage({ type: "execute", request, port: port2 } satisfies ExecuteMessage, [port2]);
  });
}
