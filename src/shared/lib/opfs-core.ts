import { contentToBlob } from "./fileContent";
import { inferContentTypeFromPath } from "./fileTypes";
import { stopPersistence, withPersistenceLock } from "./persistence";
import { decodeDataURL, readAsDataURL } from "./utils";

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
let storageReset = false;
const activeWrites = new Set<Promise<void>>();

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
  if (json === undefined) throw new TypeError(`Cannot write undefined JSON to ${path}`);
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
  await writeBlob(path, contentToBlob(content, contentType));
}

/**
 * Write binary data to a file.
 * Uses FileSystemWritableFileStream for Safari compatibility.
 */
export async function writeBlob(path: string, blob: Blob): Promise<void> {
  if (storageReset) throw new Error("Storage was reset. Reload before saving changes.");
  const { dir, name } = parsePath(path);
  const result = withPersistenceLock(`file:${dir}/${name}`, async () => {
    if (storageReset) throw new Error("Storage was reset. Reload before saving changes.");
    const directory = await getDirectory(dir, { create: true });
    let fileHandle: FileSystemFileHandle;
    let created = false;
    try {
      fileHandle = await directory.getFileHandle(name);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
      fileHandle = await directory.getFileHandle(name, { create: true });
      created = true;
    }
    let writable: FileSystemWritableFileStream | undefined;
    try {
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      // Closing after a failed write can commit truncated data over the last
      // good file. Abort the staging stream and preserve the original error.
      await writable?.abort().catch(() => {});
      // create:true makes an empty file before the write starts. Leaving it
      // behind poisons JSON loads and can masquerade as a stored hash blob.
      if (created) await directory.removeEntry(name).catch(() => {});
      throw error;
    }
  });
  activeWrites.add(result);
  try {
    await result;
  } finally {
    activeWrites.delete(result);
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
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
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
export async function readFileMetadata(
  path: string,
): Promise<{ size: number; contentType?: string; lastModified?: number } | undefined> {
  try {
    const { dir, name } = parsePath(path);
    const directory = await getDirectory(dir);
    const fileHandle = await directory.getFileHandle(name);
    const file = await fileHandle.getFile();

    return {
      size: file.size,
      contentType: inferContentType(path) || file.type,
      lastModified: file.lastModified,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
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
  storageReset = true;
  await stopPersistence();
  await Promise.allSettled(activeWrites);
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
  created?: string; // ISO date string (absent on entries written before this field existed)
  updated: string; // ISO date string
}

/**
 * Read the index for a collection.
 */
export async function readIndex(collection: string): Promise<IndexEntry[]> {
  let index: unknown;
  try {
    index = await readJson<unknown>(`${collection}/index.json`);
  } catch (error) {
    if (!(error instanceof Error && error.cause instanceof SyntaxError)) throw error;
    return healIndex(collection, error);
  }
  if (index === undefined) return [];
  if (!Array.isArray(index) || index.some((entry) => !entry || typeof entry.id !== "string" || !entry.id)) {
    return healIndex(collection, new Error(`Invalid index in ${collection}/index.json`));
  }
  return index as IndexEntry[];
}

/**
 * A damaged listing would otherwise hide every record and fail every save
 * until the user finds "Rebuild indexes". The folders are the source of
 * truth, so rebuild the listing from them and store it. Callers hold the
 * collection lock, which serializes this with every other index writer.
 */
async function healIndex(collection: string, reason: Error): Promise<IndexEntry[]> {
  console.warn(`Repairing ${collection}/index.json from stored records:`, reason);
  // Loaded lazily: the scanner depends on record parsers built on this module.
  const { isRebuildableCollection, salvageIndexEntries, scanFolderIndex } = await import("./opfs-index");
  const salvaged = await salvageIndexEntries(collection);
  const entries = isRebuildableCollection(collection) ? await scanFolderIndex(collection, salvaged) : salvaged;
  await writeJson(`${collection}/index.json`, entries);
  return entries;
}

/**
 * Write the index for a collection.
 */
export async function writeIndex(collection: string, entries: IndexEntry[]): Promise<void> {
  await withPersistenceLock(`index:${collection}`, () => writeJson(`${collection}/index.json`, entries));
}

/** Lock the complete read/modify/write, including updates from other tabs. */
export async function updateIndex(collection: string, update: (entries: IndexEntry[]) => IndexEntry[]): Promise<void> {
  await withPersistenceLock(`index:${collection}`, async () => {
    await writeJson(`${collection}/index.json`, update(await readIndex(collection)));
  });
}

/**
 * Add or update an entry in the collection index.
 */
export async function upsertIndexEntry(collection: string, entry: IndexEntry): Promise<void> {
  await updateIndex(collection, (index) => [...index.filter((item) => item.id !== entry.id), entry]);
}

/**
 * Remove an entry from the collection index.
 */
export async function removeIndexEntry(collection: string, id: string): Promise<void> {
  await updateIndex(collection, (index) => index.filter((entry) => entry.id !== id));
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
  return decodeDataURL(dataUrl);
}

/**
 * Convert a Blob to a data URL. Pass `contentType` to stamp the MIME explicitly:
 * OPFS stores raw bytes, so a blob read back from storage carries a type the
 * browser guessed from the filename (empty, application/octet-stream, or
 * application/macbinary on Safari) — never the original. Embedding that guess in
 * the data URL makes the backend reject the attachment, so callers that know the
 * real type should pass it.
 */
export function blobToDataUrl(blob: Blob, contentType?: string): Promise<string> {
  return readAsDataURL(contentType && contentType !== blob.type ? new Blob([blob], { type: contentType }) : blob);
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

  const name = parts.pop();
  if (!name) {
    throw new Error(`Invalid path: ${path}`);
  }
  const dir = parts.join("/");

  return { dir, name };
}

/**
 * Infer content type from file path extension.
 */
export function inferContentType(path: string): string | undefined {
  return inferContentTypeFromPath(path);
}
