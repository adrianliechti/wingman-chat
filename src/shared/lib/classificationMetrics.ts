import type { MeterProvider } from "@opentelemetry/sdk-metrics";

interface ClassificationMetrics {
  provider: MeterProvider;
  dirty: boolean;
  flushing?: Promise<void>;
  closed: boolean;
}

let current: ClassificationMetrics | undefined;

/** Separate from the global meter: flushing classifications must not drain
 * unrelated browser metrics or wait for their 60-second export interval. */
export function installClassificationMetrics(provider: MeterProvider): () => void {
  const state: ClassificationMetrics = { provider, dirty: false, closed: false };
  current = state;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush(state);
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    state.closed = true;
    if (current === state) current = undefined;
  };
}

export function classificationMeter() {
  return current?.provider.getMeter("wingman");
}

export function flushClassificationMetrics(): void {
  if (current) flush(current);
}

function flush(state: ClassificationMetrics): void {
  if (state.closed) return;
  state.dirty = true;
  if (state.flushing) return;
  const run = async () => {
    while (state.dirty && !state.closed) {
      state.dirty = false;
      try {
        // Start immediately. The OTel browser HTTP exporter uses keepalive for
        // these small exports and retries transient failures with the same IDs.
        await state.provider.forceFlush();
      } catch (error) {
        console.warn("Classification metrics export failed", error);
      }
    }
  };
  state.flushing = run().finally(() => {
    state.flushing = undefined;
    // Cover an observation arriving between the loop's exit and this callback.
    if (state.dirty && !state.closed) flush(state);
  });
}
