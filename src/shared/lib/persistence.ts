import { notify } from "./notify";

/** Serialize a storage operation across tabs, with an in-process fallback. */
const locks = new Map<string, Promise<unknown>>();

export function withPersistenceLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request(`wingman:${key}`, operation);
  }
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  locks.set(key, result);
  void result
    .finally(() => {
      if (locks.get(key) === result) locks.delete(key);
    })
    .catch(() => {});
  return result;
}

/**
 * Coalesce pending snapshots by ID and finish each write before starting another.
 * Deletion is an ordinary queued operation: it replaces a pending save and waits
 * for an already-running save. Failed operations stay pending for an explicit
 * flush or the next edit; they never spin in an automatic retry loop.
 */
export class PersistenceQueue {
  private pending = new Map<string, () => Promise<void>>();
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onError: (error: unknown) => void;
  private readonly delayMs: number;
  private stopped = false;

  constructor(onError: (error: unknown) => void, delayMs = 100) {
    this.onError = onError;
    this.delayMs = delayMs;
  }

  schedule(id: string, operation: () => Promise<void>): void {
    if (this.stopped) throw new Error("Storage was reset. Reload before saving changes.");
    this.pending.set(id, operation);
    // Bound the wait from the first edit, even during continuous streaming.
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(this.onError);
      }, this.delayMs);
    }
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.pending.clear();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return this.active?.catch(() => {}) ?? Promise.resolve();
  }

  /** A failure saving another record must not report this creation as failed. */
  flushRecord(id: string): Promise<void> {
    return this.flush().catch((error) => {
      if (this.pending.has(id)) throw error;
    });
  }

  flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) return this.active;

    this.active = Promise.resolve()
      .then(async () => {
        const attempted = new Set<() => Promise<void>>();
        const errors = new Map<string, unknown>();
        while (true) {
          const next = [...this.pending].find(([, operation]) => !attempted.has(operation));
          if (!next) break;
          const [id, operation] = next;
          attempted.add(operation);
          try {
            await operation();
            if (this.pending.get(id) === operation) this.pending.delete(id);
            errors.delete(id);
          } catch (error) {
            errors.set(id, error);
          }
        }
        if (errors.size) throw new AggregateError([...errors.values()], "Some changes could not be saved");
      })
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }
}

const queues = new Map<symbol, PersistenceQueue>();

export function registerPersistenceQueue(queue: PersistenceQueue): () => void {
  const token = Symbol();
  queues.set(token, queue);
  return () => queues.delete(token);
}

/** Backups must include edits that have not reached their debounce deadline. */
export async function flushPersistence(): Promise<void> {
  const results = await Promise.allSettled([...new Set(queues.values())].map((queue) => queue.flush()));
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Could not finish saving changes");
}

/**
 * Backups are the recovery path when saving itself is broken (for example a
 * corrupt index that makes every queued save fail). Report the failure but
 * still snapshot the files that did reach storage.
 */
export async function flushForBackup(): Promise<boolean> {
  try {
    await flushPersistence();
    return true;
  } catch (error) {
    console.warn("Some unsaved changes could not be included in this backup:", error);
    notify.error(
      "Backup contains saved data only",
      "Some recent changes could not be saved and are missing from this backup.",
    );
    return false;
  }
}

/** A confirmed full reset must not be undone by late debounce callbacks. */
export async function stopPersistence(): Promise<void> {
  await Promise.all([...new Set(queues.values())].map((queue) => queue.stop()));
}
