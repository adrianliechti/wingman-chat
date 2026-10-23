export interface MemorySource {
  id: string;
  hash: string;
}

export interface MemoryJob {
  chatId: string;
  model: string;
  sources: MemorySource[];
  epoch: number;
  queuedAt: number;
  attempts: number;
}

export interface MemoryState {
  version: 1;
  revision: number;
  epoch: number;
  processed: Record<string, string>;
  jobs: MemoryJob[];
  suppressed: string[];
  migration?: { paths: string[]; attempts: number };
}

export const emptyMemoryState = (): MemoryState => ({
  version: 1,
  revision: 0,
  epoch: 0,
  processed: {},
  jobs: [],
  suppressed: [],
});

export function validateMemoryState(value: unknown): asserts value is MemoryState {
  const state = value as MemoryState | undefined;
  const counter = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
  if (
    !state ||
    state.version !== 1 ||
    !counter(state.revision) ||
    !counter(state.epoch) ||
    !state.processed ||
    typeof state.processed !== "object" ||
    Array.isArray(state.processed) ||
    !Object.values(state.processed).every(hash) ||
    !Array.isArray(state.suppressed) ||
    !state.suppressed.every((s) => typeof s === "string") ||
    !Array.isArray(state.jobs) ||
    state.jobs.length > 32 ||
    state.jobs.some(
      (job) =>
        !job ||
        typeof job.chatId !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(job.chatId) ||
        typeof job.model !== "string" ||
        !counter(job.epoch) ||
        !counter(job.attempts) ||
        !counter(job.queuedAt) ||
        !Array.isArray(job.sources) ||
        job.sources.length > 16 ||
        job.sources.some((source) => !source || typeof source.id !== "string" || !hash(source.hash)),
    )
  ) {
    throw new Error("Invalid memory state. Restore from a backup before writing.");
  }
  if (
    state.migration &&
    (!Array.isArray(state.migration.paths) ||
      !state.migration.paths.every((path) => typeof path === "string") ||
      !counter(state.migration.attempts))
  )
    throw new Error("Invalid legacy memory migration state.");
}
