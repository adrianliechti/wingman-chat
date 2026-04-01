import { artifactContentToBlob } from "./artifactFiles";
import { inferContentTypeFromPath } from "./fileTypes";

/**
 * OPFS Core — File/folder CRUD, index management, storage usage, and shared utilities.
 *
 * Directory structure:
 *
 *   /skills/{name}/
 *   ├── SKILL.md              # Required - YAML frontmatter + markdown body
 *   ├── scripts/              # Optional executables
 *   ├── references/           # Optional documentation
 *   └── assets/               # Optional templates, data files
 *   /skills/index.json        # Skills index for fast listing
 *
 *   /chats/{id}/
 *   ├── chat.json             # Metadata + messages (with blob refs)
 *   ├── blobs/{uuid}.bin      # Co-located message blobs (images, audio)
 *   └── artifacts/{path}      # Artifact files stored as real files
 *   /chats/index.json         # Chats index for fast listing
 *
 *   /repositories/{id}/
 *   ├── repository.json       # Metadata (name, embedder, instructions)
 *   ├── index.json            # File listing with status
 *   └── files/{fileId}/
 *       ├── metadata.json     # File metadata
 *       ├── content.txt       # Extracted text content
 *       └── embeddings.bin    # Embedding vectors as Float32Array
 *   /repositories/index.json  # Repositories index for fast listing
 *
 *   /notebooks/{id}/
 *   ├── notebook.json         # Metadata (id, title, dates)
 *   ├── messages.json         # Chat messages
 *   ├── sources/
 *   │   ├── index.json        # Source listing
 *   │   └── {sourceId}/
 *   │       ├── metadata.json # Source metadata
 *   │       └── content.txt   # Extracted text content
 *   └── outputs/
 *       ├── index.json        # Output listing
 *       └── {outputId}/
 *           ├── metadata.json # Output metadata
 *           ├── content.txt   # Text content
 *           ├── audio.wav     # Audio (audio-overview)
 *           ├── image.png     # Image (infographic)
 *           ├── quiz.json     # Questions (quiz)
 *           ├── mindmap.json  # Tree (mind-map)
 *           └── slides/       # Slide images (slide-deck)
 *               ├── 000.png
 *               └── ...
 *   /notebooks/index.json     # Notebooks index for fast listing
 *
 *   /images/{id}/
 *   ├── metadata.json         # Metadata
 *   └── image.bin             # Image binary
 *   /images/index.json        # Images index for fast listing
 *
 *   /profile.json             # User profile settings
 */

// ============================================================================
// Core OPFS Operations
// ============================================================================

let rootHandle: FileSystemDirectoryHandle | null = null;

/**
 * Get the OPFS root directory handle.
 * Caches the handle for subsequent calls.
 */
export async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (rootHandle) {
    return rootHandle;
  }
  rootHandle = await navigator.storage.getDirectory();
  return rootHandle;
}

/**
 * Get a directory handle at the given path.
 * Creates parent directories only when create=true.
 */
export async function getDirectory(
  path: string,
  options: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  const { create = false } = options;
  const root = await getRoot();
  const parts = path.split("/").filter(Boolean);

  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }

  return current;
}

/**
 * Write JSON data to a file.
 */
export async function writeJson<T>(path: string, data: T): Promise<void> {
  const json = JSON.stringify(data);
  await writeText(path, json, "application/json");
}

/**
 * Write text data to a file.
 */
export async function writeText(
  path: string,
  content: string,
  contentType: string = "text/plain;charset=utf-8",
): Promise<void> {
  await writeBlob(path, artifactContentToBlob(content, contentType));
}

/**
 * Write binary data to a file.
 * Uses FileSystemWritableFileStream for Safari compatibility.
 */
export async function writeBlob(path: string, blob: Blob): Promise<void> {
  const { dir, name } = parsePath(path);
  const directory = await getDirectory(dir, { create: true });
  const fileHandle = await directory.getFileHandle(name, { create: true });

  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

/**
 * Read JSON data from a file.
 * Returns undefined if file doesn't exist.
 */
export async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error(`Error parsing JSON from ${path}:`, error);
    return undefined;
  }
}

/**
 * Read text content from a file.
 * Returns undefined if file doesn't exist.
 */
export async function readText(path: string): Promise<string | undefined> {
  const blob = await readBlob(path);
  if (!blob) {
    return undefined;
  }
  return blob.text();
}

/**
 * Read binary data from a file.
 * Returns undefined if file doesn't exist.
 */
export async function readBlob(path: string): Promise<Blob | undefined> {
  try {
    const { dir, name } = parsePath(path);
    const directory = await getDirectory(dir);
    const fileHandle = await directory.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file;
  } catch (error) {
    // NotFoundError is expected for missing files
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read file metadata without hydrating file content.
 * Returns undefined if file doesn't exist.
 */
export async function readFileMetadata(path: string): Promise<{ size: number; contentType?: string } | undefined> {
  const blob = await readBlob(path);
  if (!blob) {
    return undefined;
  }

  return {
    size: blob.size,
    contentType: blob.type || inferContentType(path),
  };
}

/**
 * Delete a file.
 * Silently succeeds if file doesn't exist.
 */
export async function deleteFile(path: string): Promise<void> {
  try {
    const { dir, name } = parsePath(path);
    const directory = await getDirectory(dir);
    await directory.removeEntry(name);
  } catch (error) {
    // NotFoundError is fine - file already doesn't exist
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return;
    }
    throw error;
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const { dir, name } = parsePath(path);
    const directory = await getDirectory(dir);
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

/**
 * List all files in a directory.
 * Returns file names (not full paths).
 */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const directory = await getDirectory(dirPath);
    const files: string[] = [];

    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "file") {
        files.push(name);
      }
    }

    return files;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return [];
    }
    throw error;
  }
}

/**
 * List all directories in a directory.
 * Returns directory names (not full paths).
 */
export async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const directory = await getDirectory(dirPath);
    const dirs: string[] = [];

    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "directory") {
        dirs.push(name);
      }
    }

    return dirs;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return [];
    }
    throw error;
  }
}

/**
 * Delete a directory and all its contents recursively.
 */
export async function deleteDirectory(path: string): Promise<void> {
  try {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      // Can't delete root
      return;
    }

    const parentPath = parts.slice(0, -1).join("/");
    const dirName = parts[parts.length - 1];

    const parent = parentPath ? await getDirectory(parentPath) : await getRoot();
    await parent.removeEntry(dirName, { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return;
    }
    throw error;
  }
}

/**
 * Clear all OPFS storage.
 */
export async function clearAll(): Promise<void> {
  const root = await getRoot();

  for await (const [name] of root.entries()) {
    await root.removeEntry(name, { recursive: true });
  }
}

// ============================================================================
// Index Management
// ============================================================================

export interface IndexEntry {
  id: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;
  updated: string; // ISO date string
}

/**
 * Read the index for a collection.
 */
export async function readIndex(collection: string): Promise<IndexEntry[]> {
  const index = await readJson<IndexEntry[]>(`${collection}/index.json`);
  return index || [];
}

/**
 * Write the index for a collection.
 */
export async function writeIndex(collection: string, entries: IndexEntry[]): Promise<void> {
  await writeJson(`${collection}/index.json`, entries);
}

/**
 * Add or update an entry in the collection index.
 */
export async function upsertIndexEntry(collection: string, entry: IndexEntry): Promise<void> {
  const index = await readIndex(collection);
  const existingIdx = index.findIndex((e) => e.id === entry.id);

  if (existingIdx >= 0) {
    index[existingIdx] = entry;
  } else {
    index.push(entry);
  }

  await writeIndex(collection, index);
}

/**
 * Remove an entry from the collection index.
 */
export async function removeIndexEntry(collection: string, id: string): Promise<void> {
  const index = await readIndex(collection);
  const filtered = index.filter((e) => e.id !== id);
  await writeIndex(collection, filtered);
}

/**
 * Rebuild an index by scanning all files in the collection.
 * The extractMeta function should extract id, title, and updated from the data.
 */
export async function rebuildIndex<T>(collection: string, extractMeta: (data: T) => IndexEntry): Promise<IndexEntry[]> {
  const files = await listFiles(collection);
  const entries: IndexEntry[] = [];

  for (const file of files) {
    if (file === "index.json") continue;

    const data = await readJson<T>(`${collection}/${file}`);
    if (data) {
      entries.push(extractMeta(data));
    }
  }

  await writeIndex(collection, entries);
  return entries;
}

// ============================================================================
// Storage Usage
// ============================================================================

export interface StorageEntry {
  path: string;
  size: number;
}

export interface StorageUsage {
  totalSize: number;
  entries: StorageEntry[];
}

/**
 * Calculate storage usage for all OPFS data.
 */
export async function getStorageUsage(): Promise<StorageUsage> {
  const entries: StorageEntry[] = [];
  let totalSize = 0;

  async function scanDirectory(dirPath: string, handle: FileSystemDirectoryHandle): Promise<void> {
    for await (const [name, entryHandle] of handle.entries()) {
      const entryPath = dirPath ? `${dirPath}/${name}` : name;

      if (entryHandle.kind === "file") {
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        entries.push({ path: entryPath, size: file.size });
        totalSize += file.size;
      } else {
        await scanDirectory(entryPath, entryHandle as FileSystemDirectoryHandle);
      }
    }
  }

  const root = await getRoot();
  await scanDirectory("", root);

  return { totalSize, entries };
}

// ============================================================================
// Data URL / Blob Conversion Utilities
// ============================================================================

/**
 * Convert a data URL to a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
  const byteCharacters = atob(base64);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteNumbers], { type: mimeType });
}

/**
 * Convert a Blob to a data URL.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if a string is a data URL.
 */
export function isDataUrl(str: string): boolean {
  return str.startsWith("data:");
}

/**
 * Check if a string is a blob reference (path to blob storage).
 */
export function isBlobRef(str: string): boolean {
  return str.startsWith("blob:");
}

/**
 * Create a blob reference string.
 */
export function createBlobRef(id: string): string {
  return `blob:${id}`;
}

/**
 * Extract blob ID from a blob reference.
 */
export function parseBlobRef(ref: string): string | null {
  if (!ref.startsWith("blob:")) {
    return null;
  }
  return ref.slice(5);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a path into directory and filename.
 */
export function parsePath(path: string): { dir: string; name: string } {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Invalid path: empty");
  }

  const name = parts.pop()!;
  const dir = parts.join("/");

  return { dir, name };
}

/**
 * Infer content type from file path extension.
 */
export function inferContentType(path: string): string | undefined {
  return inferContentTypeFromPath(path);
}
