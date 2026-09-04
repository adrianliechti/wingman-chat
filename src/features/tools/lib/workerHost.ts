/**
 * Generic main-thread host for an interpreter Web Worker: stall watchdog, abort
 * handling, crash recovery, and RPC reply plumbing. An engine plugs in only its
 * worker factory and RPC dispatcher.
 */

import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  ExecuteReply,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";
import { resolveCodeExecutionLimits, validateArtifactFiles } from "./executionLimits";

export interface ExecuteCodeOptions {
  /** Aborts the run (e.g. the user's Stop): terminates the worker and settles. */
  signal?: AbortSignal;
  /** Override the compute-stall ceiling. */
  timeoutMs?: number;
}

export interface WorkerHostConfig {
  /** Spawn a fresh worker. Called on first use and after a crash/teardown. */
  createWorker(): Worker;
  /** Answer one worker→main RPC; the resolved value is posted back on the reply port. */
  handleMessage(message: WorkerToMainMessage, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** Message used when the worker dies on an uncaught error. */
  crashMessage: string;
  /** Pure-compute stall ceiling before the run is treated as wedged. */
  computeStallMs?: number;
  /** Bootstrap budget before the worker reports user code has started. */
  startupStallMs?: number;
  /** Reuse the runtime after a successful execution. Defaults to true. */
  reuseWorker?: boolean;
}

/** Pure-compute no-progress ceiling before the run is treated as wedged and
 * force-terminated. Bridge calls pause this (they have their own network
 * timeout), so a slow render isn't killed but an infinite loop still recovers. */
const DEFAULT_COMPUTE_STALL_MS = 120_000;

/** Bootstrap budget (module load + runtime init) before user code starts. Kept
 * separate from — and more generous than — the compute-stall budget so a slow
 * cold start isn't mistaken for a wedged loop. */
const DEFAULT_STARTUP_STALL_MS = 180_000;

export interface WorkerHost {
  execute(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult>;
}

export function createWorkerHost(config: WorkerHostConfig): WorkerHost {
  const computeStallDefault = config.computeStallMs ?? DEFAULT_COMPUTE_STALL_MS;
  const startupStallMs = config.startupStallMs ?? DEFAULT_STARTUP_STALL_MS;

  let worker: Worker | null = null;
  let executionTail: Promise<CodeExecutionResult> | null = null;

  // Each in-flight execution registers a "worker died" callback so it settles
  // with an error instead of hanging on a reply port that will never arrive.
  const pendingFailures = new Set<() => void>();

  // The in-flight execution's stall watchdog, paused while the worker is blocked
  // on a main-thread RPC (those round trips are bounded separately). Runs are
  // serialized, so a single slot suffices.
  let activeBridge: { enter: () => void; leave: () => void; signal?: AbortSignal } | null = null;

  async function replyOnPort(
    port: MessagePort,
    bridge: typeof activeBridge,
    run: () => Promise<unknown>,
  ): Promise<void> {
    // The worker is waiting on us, not stalled — pause its stall timer. Capture
    // the slot now so a reply that lands after teardown can't disturb the next run.
    bridge?.enter();
    let reply: RpcReply;
    try {
      reply = { ok: true, value: await run() };
    } catch (error) {
      reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      bridge?.leave();
    }
    // Abort/teardown may close the transferred port while the main-thread RPC
    // is still settling. A late reply must not become an unhandled rejection.
    try {
      port.postMessage(reply);
    } catch {
      // The owning run has already ended; there is no receiver left to notify.
    } finally {
      port.close();
    }
  }

  function getWorker(): Worker {
    if (!worker) {
      const created = config.createWorker();
      created.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
        const message = event.data;
        // Sandboxed user code can `self.postMessage(...)` directly; ignore
        // anything not shaped like an RPC so it can't wedge the dispatcher.
        if (typeof message?.port?.postMessage !== "function") return;
        const bridge = activeBridge;
        void replyOnPort(message.port, bridge, () => config.handleMessage(message, { signal: bridge?.signal }));
      });
      created.addEventListener("error", (event) => {
        // Drop the dead worker so the next call spawns a fresh one.
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
    const run = () => executeNow(request, options);
    // Runtime state and bridge replies belong to exactly one execution at a time.
    // This also covers UI runs and different chats, independently of workspace locks.
    const result = executionTail ? executionTail.then(run, run) : run();
    executionTail = result;
    const clear = () => {
      if (executionTail === result) executionTail = null;
    };
    void result.then(clear, clear);
    return result;
  }

  function executeNow(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
    if (options?.signal?.aborted) return Promise.resolve({ success: false, output: "", error: "Execution cancelled" });
    const stallMs = options?.timeoutMs ?? computeStallDefault;
    const signal = options?.signal;

    // Reject malformed or oversized inputs before paying the cost of starting a
    // runtime. Workers repeat these checks as a defense-in-depth boundary.
    try {
      const limits = resolveCodeExecutionLimits(request.limits);
      validateArtifactFiles(request.files ?? {}, limits, "Interpreter input");
    } catch (error) {
      return Promise.resolve({
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }

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

    // Every termination path funnels through `settle`; `fail` is settle-with-
    // error that also tears down the wedged worker.
    return new Promise<CodeExecutionResult>((resolve) => {
      const { port1, port2 } = new MessageChannel();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let inFlight = 0;
      let settled = false;
      let started = false;

      // A wedged run can't be interrupted cooperatively — tear the worker down
      // (next call respawns) and settle so the caller's sandbox lock releases.
      const fail = (error: string) => {
        if (worker === target) worker = null;
        target.terminate();
        settle({ success: false, output: "", error });
      };
      // (Re)arm the stall timer — only while no bridge call is in flight, so it
      // measures uninterrupted compute time, not wall-clock.
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
        signal,
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
        if (config.reuseWorker === false && worker === target) {
          worker = null;
          target.terminate();
        }
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
