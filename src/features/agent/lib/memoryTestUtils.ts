import type { MemoryFileSystem } from "./memoryStore";

/** Map-backed {@link MemoryFileSystem} for tests. */
export function createFakeMemoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, { content: string; lastModified: number }>();
  let clock = 1_700_000_000_000;
  for (const [path, content] of Object.entries(initial)) files.set(path, { content, lastModified: clock++ });

  const fs: MemoryFileSystem = {
    async readText(path) {
      return files.get(path)?.content;
    },
    async writeText(path, content) {
      files.set(path, { content, lastModified: clock++ });
    },
    async deleteFile(path) {
      files.delete(path);
    },
    async listFiles(dir) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length))
        .sort();
    },
    async fileExists(path) {
      return files.has(path);
    },
    async readFileMetadata(path) {
      const file = files.get(path);
      return file ? { lastModified: file.lastModified } : undefined;
    },
  };

  return { fs, files };
}
