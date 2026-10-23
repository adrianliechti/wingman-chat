import {
  deleteDirectory,
  deleteFile,
  getDirectory,
  listDirectories,
  listFiles,
  readBlob,
  writeBlob,
} from "./opfs-core";

/**
 * Apply a prepared group of file changes, restoring the previous bytes on an
 * I/O failure. The caller holds the relevant collection/workspace locks.
 * This is rollback for reported failures, not a browser-crash transaction.
 */
export async function writeFileChanges(
  changes: ReadonlyMap<string, Blob | undefined>,
  { afterWrite, extraPaths = [] }: { afterWrite?: () => Promise<void>; extraPaths?: string[] } = {},
): Promise<void> {
  const previous = new Map<string, Blob | undefined>();
  const createdDirectories = new Set<string>();
  for (const path of [...changes.keys(), ...extraPaths]) {
    const old = await readBlob(path);
    // An OPFS File snapshot can become unreadable when its source is changed.
    previous.set(path, old ? new Blob([await old.arrayBuffer()]) : undefined);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      try {
        await getDirectory(parent);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
        createdDirectories.add(parent);
      }
    }
  }
  const attempted: string[] = [];
  try {
    for (const [path, blob] of changes) {
      attempted.push(path);
      if (blob) await writeBlob(path, blob);
      else await deleteFile(path);
    }
    attempted.push(...extraPaths);
    await afterWrite?.();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of attempted.reverse()) {
      try {
        const old = previous.get(path);
        if (old) await writeBlob(path, old);
        else await deleteFile(path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const path of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try {
        if (!(await listFiles(path)).length && !(await listDirectories(path)).length) await deleteDirectory(path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length)
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Write failed and some previous files could not be restored",
      );
    throw error;
  }
}
