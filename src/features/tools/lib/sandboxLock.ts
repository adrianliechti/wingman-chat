/**
 * Serializes sandbox tool executions, including their snapshot/sync-back
 * phases. The runtimes are shared singletons (one bash InMemoryFs, one
 * Pyodide FS), and every execution tool runs "snapshot store → execute →
 * commit full post-run snapshot". When a model issues parallel tool calls,
 * both snapshot before either commits, so the later commit resurrects or
 * deletes the earlier run's outputs (classic lost update) — and concurrent
 * bash runs would interleave on the same working tree mid-command.
 *
 * NOT reentrant: never take the lock from code that already runs under it
 * (e.g. the `python3` command inside a locked bash run) — that deadlocks.
 */
let chain: Promise<void> = Promise.resolve();

export function withSandboxLock<T>(run: () => Promise<T>): Promise<T> {
  const result = chain.then(run);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
