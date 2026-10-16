/**
 * Generic main-thread host for an interpreter Web Worker: stall watchdog, abort
 * handling, crash recovery, and RPC reply plumbing. An engine plugs in only its
 * worker factory and RPC dispatcher.
 */

import { Debouncer } from "@tanstack/pacer";
import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  ExecuteReply,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";
import { resolveCodeExecutionLimits, validateArtifactFiles } from "./executionLimits";
import type { ToolContext } from "@/shared/types/chat";
import { withAbort } from "@/shared/lib/abortSignals";

export interface ExecuteCodeOptions {
  /** Aborts the run (e.g. the user's Stop): terminates the worker and settles. */
  signal?: AbortSignal;
  /** Override the compute-stall ceiling. */
  timeoutMs?: number;
  /** Captured run context for model calls made by the interpreter. */
  context?: Pick<ToolContext, "model" | "invocationContext" | "agentContext" | "chatId">;
}

export type BridgeRequestOptions = Pick<ExecuteCodeOptions, "signal" | "context">;

export interface WorkerHostConfig {
  /** Spawn a fresh worker. Called on first use and after a crash/teardown. */
  createWorker(): Worker;
  /** Answer one worker→main RPC; the resolved value is posted back on the reply port. */
  handleMessage(message: WorkerToMainMessage, options?: BridgeRequestOptions): Promise<unknown>;
  /** Message used when the worker dies on an uncaught error. */
  crashMessage: string;
  /** Pure-compute stall ceiling before the run is treated as wedged. */
  computeStallMs?: number;
  /** Bootstrap budget before the worker reports user code has started. */
  startupStallMs?: number;
  /** Reuse the runtime after a successful execution. Defaults to true. */
  reuseWorker?: boolean;
  /** Release a reusable runtime after this much idle time. Defaults to one minute. */
  idleTimeoutMs?: number;
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
  // A reusable worker is terminated after sitting idle; a new execution cancels that.
  const idleShutdown = new Debouncer(
    (target: Worker) => {
      if (worker !== target || activeBridge) return;
      worker = null;
      target.terminate();
    },
    { wait: config.idleTimeoutMs ?? 60_000 },
  );

  // Each in-flight execution registers a "worker died" callback so it settles
  // with an error instead of hanging on a reply port that will never arrive.
  const pendingFailures = new Set<() => void>();

  // The in-flight execution's stall watchdog, paused while the worker is blocked
  // on a main-thread RPC (those round trips are bounded separately). Runs are
  // serialized, so a single slot suffices.
  let activeBridge: ({ enter: () => void; leave: () => void } & BridgeRequestOptions) | null = null;

  async function replyOnPort(
    port: MessagePort,
    bridge: NonNullable<typeof activeBridge>,
    run: () => Promise<unknown>,
  ): Promise<void> {
    // The worker is waiting on us, not stalled — pause its stall timer. Capture
    // the slot now so a reply that lands after teardown can't disturb the next run.
    bridge.enter();
    let reply: RpcReply;
    try {
      reply = { ok: true, value: await withAbort(bridge.signal!, run) };
    } catch (error) {
      reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      bridge.leave();
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
    idleShutdown.cancel();
    if (!worker) {
      const created = config.createWorker();
      created.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
        const message = event.data;
        // Sandboxed user code can `self.postMessage(...)` directly; ignore
        // anything not shaped like an RPC so it can't wedge the dispatcher.
        if (typeof message?.port?.postMessage !== "function") return;
        const bridge = activeBridge;
        if (!bridge || worker !== created) {
          message.port.close();
          return;
        }
        void replyOnPort(message.port, bridge, () =>
          config.handleMessage(message, { signal: bridge.signal, context: bridge.context }),
        );
      });
      const onFailure = () => {
        if (worker !== created) return;
        const failures = [...pendingFailures];
        worker = null;
        if (failures.length) failures.forEach((fail) => fail());
        else created.terminate();
      };
      created.addEventListener("error", onFailure);
      created.addEventListener("messageerror", onFailure);
      worker = created;
    }
    return worker;
  }

  function execute(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
    const signal = AbortSignal.any(
      [options?.signal, options?.context?.invocationContext?.signal].filter(
        (source): source is AbortSignal => !!source,
      ),
    );
    const run = () => executeNow(request, { ...options, signal });
    // Runtime state and bridge replies belong to exactly one execution at a time.
    // This also covers UI runs and different chats, independently of workspace locks.
    const queued = executionTail !== null;
    const scheduled = executionTail ? executionTail.then(run, run) : run();
    // Cancelling a queued caller settles it immediately, while its queue slot
    // stays behind the running job. No later caller can jump into that runtime.
    const result = queued
      ? withAbort(signal, () => scheduled).catch((error: unknown) => {
          if (!signal.aborted) throw error;
          return { success: false, output: "", error: "Execution cancelled" };
        })
      : scheduled;
    executionTail = scheduled;
    const clear = () => {
      if (executionTail === scheduled) executionTail = null;
    };
    void scheduled.then(clear, clear);
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
      let inFlight = 0;
      let settled = false;
      let started = false;
      const executionController = new AbortController();
      const bridgeSignal = AbortSignal.any([executionController.signal, ...(signal ? [signal] : [])]);

      // A wedged run can't be interrupted cooperatively — tear the worker down
      // (next call respawns) and settle so the caller's sandbox lock releases.
      const fail = (error: string) => {
        if (settled) return;
        if (worker === target) worker = null;
        target.terminate();
        settle({ success: false, output: "", error });
      };
      // The stall watchdog fires after uninterrupted compute time, not wall-clock:
      // it is armed only while no bridge call is in flight and re-armed on progress.
      const watchdog = new Debouncer(
        () =>
          fail(
            started
              ? `Code execution stalled — no progress for ${Math.round(stallMs / 1000)}s (worker terminated)`
              : `Interpreter startup timed out after ${Math.round(startupStallMs / 1000)}s (worker terminated)`,
          ),
        { wait: () => (started ? stallMs : startupStallMs) },
      );
      const arm = () => {
        if (settled) return;
        if ((started ? stallMs : startupStallMs) <= 0) return;
        watchdog.maybeExecute();
      };
      const bridge = {
        signal: bridgeSignal,
        context: options?.context,
        enter: () => {
          inFlight++;
          watchdog.cancel();
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
        watchdog.cancel();
        if (activeBridge === bridge) activeBridge = null; // only the owner clears the shared slot
        pendingFailures.delete(onCrash);
        signal?.removeEventListener("abort", onAbort);
        executionController.abort();
        port1.onmessage = port1.onmessageerror = null;
        port1.close();
        port2.close();
        if (worker === target) {
          if (config.reuseWorker === false || !result.success) {
            worker = null;
            target.terminate();
          } else {
            idleShutdown.maybeExecute(target);
          }
        }
        resolve(result);
      }

      port1.onmessage = (event: MessageEvent<ExecuteReply>) => {
        const reply = event.data;
        if (reply.type === "started") {
          started = true;
          if (inFlight === 0) arm();
          return;
        }
        settle(reply.result);
      };
      port1.onmessageerror = onCrash;
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
      try {
        target.postMessage({ type: "execute", request, port: port2 } satisfies ExecuteMessage, [port2]);
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to start code execution");
      }
    });
  }

  return { execute };
}
