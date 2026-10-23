/** Stop waiting when the owner goes away, including for APIs without signal support. */
export async function withAbort<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** A controller that follows `signal`, for APIs that take a controller instead of a signal. */
export function followAbortSignal(...sources: Array<AbortSignal | undefined>): {
  controller: AbortController;
  cleanup: () => void;
} {
  const signal = AbortSignal.any(sources.filter((source): source is AbortSignal => source !== undefined));
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return { controller, cleanup: () => signal.removeEventListener("abort", abort) };
}
