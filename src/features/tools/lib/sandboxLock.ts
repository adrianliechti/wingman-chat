/**
 * Serializes sandbox tool executions, including their snapshot/sync-back
 * phases. Each runtime is a session-long singleton (one Pyodide FS, one JS
 * worker), and every execution tool runs "snapshot store → execute → commit
 * full post-run snapshot". When a model issues parallel tool calls, both
 * snapshot before either commits, so the later commit resurrects or deletes
 * the earlier run's outputs (classic lost update). The Python and JavaScript
 * tools share this one lock because they commit to the same artifact store.
 *
 * NOT reentrant: never take the lock from code that already runs under it —
 * that deadlocks.
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
