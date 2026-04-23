/**
 * Canonical file-system entry shared across features.
 *
 * - `path` is the unique identifier (a POSIX-style relative path such as
 *   `reports/q3.md` or `https://example.com/page.html`).
 * - `content` holds either UTF-8 text or a `data:` URL for binary payloads.
 * - `contentType` is optional; when absent, callers may infer it from the
 *   path extension via `inferContentTypeFromPath`.
 */
export interface File {
  path: string;
  content: string;
  contentType?: string;
}

/** Lightweight listing entry (no content). */
export interface FileEntry {
  path: string;
  contentType?: string;
  size?: number;
}

/**
 * Minimal reactive filesystem interface used by UI components that need to
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

