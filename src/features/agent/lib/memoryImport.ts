import { readText } from "@/shared/lib/opfs-core";
import { bytes, isMemoryIndex, MEMORY_BUNDLE_MAX_BYTES, MEMORY_MAX_NOTES, memoryIndexes } from "./memoryDocument";
import { listMemoryTree } from "./memoryManager";

/** Called inside the agents collection lock, before any restore writes. */
export async function prepareMemoryImport(changes: Map<string, Blob | undefined>): Promise<void> {
  const owners = new Set([...changes.keys()].flatMap((path) => path.match(/^agents\/([^/]+)\/memory\//)?.[1] ?? []));
  for (const owner of owners) {
    const directory = `agents/${owner}/memory/`;
    const previous = await listMemoryTree(directory);
    const notes = new Map<string, string>();
    for (const path of previous) {
      if (!path.endsWith(".md") || isMemoryIndex(path)) continue;
      const text = await readText(directory + path);
      if (text !== undefined) notes.set(path, text);
    }
    for (const [path, blob] of changes) {
      if (!path.startsWith(directory) || isMemoryIndex(path)) continue;
      if (blob) notes.set(path.slice(directory.length), await blob.text());
    }
    if (
      notes.size > MEMORY_MAX_NOTES ||
      [...notes.values()].reduce((sum, text) => sum + bytes(text), 0) > MEMORY_BUNDLE_MAX_BYTES
    )
      throw new Error(`Imported memory for ${owner} exceeds the 256-note / 1 MiB limit.`);
    const indexes = memoryIndexes(notes);
    for (const path of previous)
      if (/(?:^|\/)index\.md$/.test(path) && !indexes.has(path)) changes.set(directory + path, undefined);
    // Ignore archive-supplied indexes: they can be stale or refer to other notes.
    for (const [path, blob] of changes)
      if (blob && path.startsWith(directory) && /(?:^|\/)index\.md$/.test(path)) changes.delete(path);
    for (const [path, text] of indexes) changes.set(directory + path, new Blob([text]));
  }
}
