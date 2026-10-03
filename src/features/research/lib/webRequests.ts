export const MAX_WEB_BATCH = 8;
const CONCURRENCY = 4;
const CACHE_ENTRIES = 16;

export function stringArray(value: unknown, max = MAX_WEB_BATCH): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected an array of strings");
  }
  const unique = [...new Set(value.map((entry: string) => entry.trim()).filter(Boolean))];
  if (unique.length > max) throw new Error(`Use at most ${max} distinct entries per call.`);
  if (unique.some((entry) => entry.length > 2048)) throw new Error("Entries must be at most 2048 characters.");
  return unique;
}

export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Bounded concurrency, ordered partial failures, and cancellation between jobs. */
export async function webBatch<T>(
  values: string[],
  request: (value: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<T>[]> {
  signal?.throwIfAborted();
  const results: PromiseSettledResult<T>[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
      while (next < values.length) {
        signal?.throwIfAborted();
        const index = next++;
        try {
          results[index] = { status: "fulfilled", value: await request(values[index]) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  signal?.throwIfAborted();
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length && failed.length === results.length) throw failed[0].reason;
  return results;
}

/** The agent passes one signal per run. Never reuse data or cancellation across runs. */
export function runCache<T>(retain: (value: T) => boolean) {
  const scopes = new WeakMap<AbortSignal, Map<string, Promise<T>>>();
  return (key: string, request: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
    if (!signal) return request();
    let cache = scopes.get(signal);
    if (!cache) {
      cache = new Map();
      scopes.set(signal, cache);
      const entries = cache;
      signal.addEventListener("abort", () => entries.clear(), { once: true });
    }
    const previous = cache.get(key);
    if (previous) return previous;
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    const entries = cache;
    const pending = Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return request();
      })
      .then((value) => {
        signal.throwIfAborted();
        if (!retain(value) && entries.get(key) === pending) entries.delete(key);
        return value;
      })
      .catch((error: unknown) => {
        if (entries.get(key) === pending) entries.delete(key);
        throw error;
      });
    entries.set(key, pending);
    return pending;
  };
}
