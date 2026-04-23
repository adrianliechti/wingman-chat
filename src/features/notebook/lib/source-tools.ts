/**
 * Source access tools for notebooks.
 * Wraps notebook sources as a ReadableFileSource for the shared file tools.
 */

import {
  createReadOnlyFileTools,
  type FileData,
  type FileEntry,
  type ReadableFileSource,
} from "@/shared/lib/file-tools";
import type { Tool } from "@/shared/types/chat";
import type { NotebookSource } from "../types/notebook";

/**
 * Adapt NotebookSource[] into a ReadableFileSource.
 */
function createSourceAdapter(sources: NotebookSource[]): ReadableFileSource {
  return {
    async list(): Promise<FileEntry[]> {
      return sources.map((s) => ({
        path: s.id,
        size: s.content.length,
        contentType: s.type === "web" ? "text/html" : "text/plain",
      }));
    },

    async read(path: string): Promise<FileData | undefined> {
      const source = sources.find((s) => s.id === path);
      if (!source) return undefined;
      return {
        path: source.id,
        content: source.content,
      };
    },
  };
}

/**
 * Create source access tools for the LLM.
 */
export function createSourceTools(sources: NotebookSource[]): Tool[] {
  return createReadOnlyFileTools(createSourceAdapter(sources), {
    namespace: "source_",
  });
}
