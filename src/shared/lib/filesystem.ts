import type { File } from "@/features/artifacts/types/file";

/**
 * Minimal read-only filesystem interface used by UI components that need to
 * source companion files by path (HTML preview, markdown asset resolver, ...).
 *
 * Compatible with `FileSystemManager` in the artifacts feature.
 */
export interface FileSystem {
  listFiles(): Promise<File[]>;
  getFile(path: string): Promise<File | undefined>;
  subscribe(eventType: "fileCreated" | "fileUpdated", handler: (path: string) => void): () => void;
  subscribe(eventType: "fileDeleted", handler: (path: string) => void): () => void;
  subscribe(eventType: "fileRenamed", handler: (oldPath: string, newPath: string) => void): () => void;
}
