export interface CombinedAbortSignal {
  signal?: AbortSignal;
  cleanup(): void;
}

/** Combine cancellation sources while retaining cleanup for the listener fallback. */
export function combineAbortSignals(...values: Array<AbortSignal | undefined>): CombinedAbortSignal {
  const signals = [...new Set(values.filter((value): value is AbortSignal => value !== undefined))];
  if (signals.length === 0) return { cleanup() {} };
  if (signals.length === 1) return { signal: signals[0], cleanup() {} };

  if (typeof AbortSignal.any === "function") {
    try {
      return { signal: AbortSignal.any(signals), cleanup() {} };
    } catch {
      // Older partial implementations can expose `any` without accepting an iterable.
    }
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; abort: () => void }> = [];
  for (const signal of signals) {
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
    listeners.push({ signal, abort });
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const { signal, abort } of listeners) signal.removeEventListener("abort", abort);
    },
  };
}
