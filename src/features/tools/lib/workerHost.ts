/**
 * Generic main-thread host for an interpreter Web Worker.
 *
 * Both interpreters — Pyodide (`interpreter.worker.ts`) and JavaScript
 * (`javascript.worker.ts`) — run user code in a dedicated module worker so
 * CPU-bound code cannot freeze the UI, and both need the exact same lifecycle
 * around that worker: a stall watchdog, abort handling, crash recovery, and a
 * way to answer the worker's main-thread RPCs (each carrying its own reply
 * MessagePort — see interpreterProtocol.ts). This module owns all of that; an
 * engine plugs in only its worker factory and its RPC dispatcher.
 */

import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  ExecuteReply,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";

export interface ExecuteCodeOptions {
  /** Aborts the run (e.g. the user's Stop): terminates the worker and settles. */
  signal?: AbortSignal;
  /** Override the compute-stall ceiling. */
  timeoutMs?: number;
}

export interface WorkerHostConfig {
  /** Spawn a fresh worker. Called on first use and after a crash/teardown. */
  createWorker(): Worker;
  /**
   * Answer one worker→main RPC. The resolved value is posted back on the
   * request's reply port; a rejection is forwarded as an error reply.
   */
  handleMessage(message: WorkerToMainMessage): Promise<unknown>;
  /** Message used when the worker dies on an uncaught error. */
  crashMessage: string;
  /** Pure-compute stall ceiling before the run is treated as wedged. */
  computeStallMs?: number;
  /** Bootstrap budget before the worker reports user code has started. */
  startupStallMs?: number;
}

/** How long the worker may run *pure compute* with no progress before it's
 * treated as wedged (infinite loop / hang) and force-terminated. Bridge calls
 * (render/synthesize/…) pause this — they're bounded by their own network
 * timeout — so a legitimately slow render or a multi-segment podcast is never
 * killed, while an infinite loop recovers in ~this long instead of minutes. */
const DEFAULT_COMPUTE_STALL_MS = 120_000;

/** Budget for the bootstrap phase (worker module load + runtime init + wheel
 * downloads) before the worker reports user code has started. Kept separate from
 * — and more generous than — the compute-stall budget so a slow first run on a
 * cold cache isn't mistaken for a wedged infinite loop and killed mid-download.
 * It's only a backstop to release the sandbox lock if the load truly hangs. */
const DEFAULT_STARTUP_STALL_MS = 180_000;

export interface WorkerHost {
  execute(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult>;
}

export function createWorkerHost(config: WorkerHostConfig): WorkerHost {
  const computeStallDefault = config.computeStallMs ?? DEFAULT_COMPUTE_STALL_MS;
  const startupStallMs = config.startupStallMs ?? DEFAULT_STARTUP_STALL_MS;

  let worker: Worker | null = null;

  // Each in-flight execution registers a "worker died" callback so it settles
  // with an error instead of hanging on a reply port that will never arrive.
  const pendingFailures = new Set<() => void>();

  // The in-flight execution's stall watchdog. The bridge-request handler pauses
  // it while the worker is blocked on a main-thread RPC (those round trips are
  // bounded separately). Only one execution runs at a time — the sandbox lock
  // serializes them — so a single slot suffices.
  let activeBridge: { enter: () => void; leave: () => void } | null = null;

  async function replyOnPort(port: MessagePort, run: () => Promise<unknown>): Promise<void> {
    // A bridge call means the worker is waiting on us, not stalled — pause its
    // stall timer while it's in flight. Capture the slot now so a reply that
    // lands after the run was torn down can't disturb whatever runs next.
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
      const created = config.createWorker();
      created.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
        const message = event.data;
        // Defensive: a genuine RPC always ships its reply port. Sandboxed user
        // code can call `self.postMessage(...)` directly; ignore anything that
        // isn't shaped like an RPC so it can't wedge the dispatcher.
        if (typeof message?.port?.postMessage !== "function") return;
        void replyOnPort(message.port, () => config.handleMessage(message));
      });
      created.addEventListener("error", (event) => {
        // The worker script failed to load or died on an uncaught error. Drop it
        // so the next call spawns a fresh one (which rebuilds runtime state).
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

  function execute(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
    const stallMs = options?.timeoutMs ?? computeStallDefault;
    const signal = options?.signal;

    let target: Worker;
    try {
      target = getWorker();
    } catch (error) {
      return Promise.resolve({
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Every termination path (result, stall, abort, crash) funnels through a
    // single `settle`; `fail` is settle-with-error and also tears down the
    // wedged worker.
    return new Promise<CodeExecutionResult>((resolve) => {
      const { port1, port2 } = new MessageChannel();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let inFlight = 0;
      let settled = false;
      let started = false;

      // A wedged run can't be interrupted cooperatively, so tear the worker
      // down: the next call spawns a fresh one, and settling here releases the
      // caller's sandbox lock instead of blocking every queued execution.
      const fail = (error: string) => {
        if (worker === target) worker = null;
        target.terminate();
        settle({ success: false, output: "", error });
      };
      // (Re)arm the stall timer; runs only while no bridge call is in flight, so
      // it measures uninterrupted pure-compute time, not total wall-clock.
      const arm = () => {
        if (settled) return;
        const ms = started ? stallMs : startupStallMs;
        if (ms <= 0) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () =>
            fail(
              started
                ? `Code execution stalled — no progress for ${Math.round(stallMs / 1000)}s (worker terminated)`
                : `Interpreter startup timed out after ${Math.round(startupStallMs / 1000)}s (worker terminated)`,
            ),
          ms,
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
      const onCrash = () => fail(config.crashMessage);
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

      port1.onmessage = (event: MessageEvent<ExecuteReply>) => {
        const reply = event.data;
        if (reply.type === "started") {
          started = true;
          arm();
          return;
        }
        settle(reply.result);
      };
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

  return { execute };
}
