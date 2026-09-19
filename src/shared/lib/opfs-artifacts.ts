/**
 * OPFS Artifacts — Artifact file CRUD within chat folders.
 */

import {
  ArtifactRevisionEntrySchema,
  type ArtifactRevisionEntry,
  type RevisionOrigin,
} from "@/shared/types/artifact";
import { contentToBlob, dataUrlDecodedByteLength } from "./fileContent";
import { isBinaryContentType } from "./fileTypes";
import {
  blobToDataUrl,
  deleteDirectory,
  deleteFile,
  inferContentType,
  listDirectories,
  listFiles,
  readBlob,
  readFileMetadata,
  readJson,
  writeBlob,
  writeJson,
  writeText,
} from "./opfs-core";
import { withPersistenceLock } from "./persistence";
import { normalizeArtifactPath } from "./sandbox";

export interface ArtifactEntry {
  path: string;
  contentType?: string;
  size: number;
  lastModified?: number;
}

export interface StoredArtifactRevision {
  path: string;
  revision: string;
  content: string;
  contentType?: string;
  createdAt: string;
  origin?: RevisionOrigin;
}

/**
 * Revision files are content-addressed and immutable. A per-path log next to
 * them records the order revisions were produced in, so a restore that
 * reproduces an earlier hash still shows up as a new step, and listing never
 * has to read revision content.
 */
const REVISION_LOG_FILE = "history.json";

function artifactRevisionDirectory(chatId: string, path: string): string {
  const encodedPath = encodeURIComponent(normalizeArtifactPath(path) ?? path);
  return `chats/${chatId}/artifact-versions/${encodedPath}`;
}

function artifactRevisionPath(chatId: string, path: string, revision: string): string {
  return `${artifactRevisionDirectory(chatId, path)}/${encodeURIComponent(revision)}.json`;
}

/** Byte size of stored content: decoded bytes for data URLs, UTF-8 bytes for text. */
export function artifactContentByteLength(content: string): number {
  return dataUrlDecodedByteLength(content) ?? new TextEncoder().encode(content).byteLength;
}

function withRevisionLogLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  return withPersistenceLock(`artifact-history:${directory}`, operation);
}

async function readRevisionLog(directory: string): Promise<ArtifactRevisionEntry[]> {
  let stored: unknown;
  try {
    stored = await readJson<unknown>(`${directory}/${REVISION_LOG_FILE}`);
  } catch {
    return [];
  }
  const entries = (stored as { entries?: unknown } | undefined)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const parsed = ArtifactRevisionEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function writeRevisionLog(directory: string, entries: ArtifactRevisionEntry[]): Promise<void> {
  return writeJson(`${directory}/${REVISION_LOG_FILE}`, { entries });
}

/**
 * Archive a revision and append it to the path's log. Re-archiving the
 * revision that is already last in the log is a no-op, so a pre-image
 * snapshot taken before an update does not duplicate the entry that
 * produced it.
 */
export async function archiveArtifactRevision(chatId: string, revision: StoredArtifactRevision): Promise<void> {
  const directory = artifactRevisionDirectory(chatId, revision.path);
  await writeJson(artifactRevisionPath(chatId, revision.path, revision.revision), revision);
  await withRevisionLogLock(directory, async () => {
    const entries = await readRevisionLog(directory);
    if (entries.at(-1)?.revision === revision.revision) return;
    entries.push({
      revision: revision.revision,
      createdAt: revision.createdAt,
      size: artifactContentByteLength(revision.content),
      contentType: revision.contentType,
      origin: revision.origin,
    });
    await writeRevisionLog(directory, entries);
  });
}

export async function loadArtifactRevision(
  chatId: string,
  path: string,
  revision: string,
): Promise<StoredArtifactRevision | undefined> {
  return readJson<StoredArtifactRevision>(artifactRevisionPath(chatId, path, revision));
}

export async function listArtifactRevisions(chatId: string, path: string): Promise<string[]> {
  const files = await listFiles(artifactRevisionDirectory(chatId, path));
  return files
    .filter((file) => file.endsWith(".json") && file !== REVISION_LOG_FILE)
    .map((file) => decodeURIComponent(file.slice(0, -5)));
}

/**
 * Ordered revision entries for a path, oldest first. Revision files missing
 * from the log (chats archived before the log existed, or a failed append)
 * are merged in by their stored timestamp and the repaired log is persisted.
 */
export async function listArtifactRevisionEntries(chatId: string, path: string): Promise<ArtifactRevisionEntry[]> {
  const directory = artifactRevisionDirectory(chatId, path);
  return withRevisionLogLock(directory, async () => {
    const entries = await readRevisionLog(directory);
    const known = new Set(entries.map((entry) => entry.revision));
    const orphans: ArtifactRevisionEntry[] = [];
    for (const revision of await listArtifactRevisions(chatId, path)) {
      if (known.has(revision)) continue;
      let stored: StoredArtifactRevision | undefined;
      try {
        stored = await readJson<StoredArtifactRevision>(`${directory}/${encodeURIComponent(revision)}.json`);
      } catch {
        continue;
      }
      if (!stored || typeof stored.content !== "string") continue;
      const parsed = ArtifactRevisionEntrySchema.safeParse({
        revision,
        createdAt: stored.createdAt,
        size: artifactContentByteLength(stored.content),
        contentType: stored.contentType,
        origin: stored.origin,
      });
      if (parsed.success) orphans.push(parsed.data);
    }
    if (orphans.length === 0) return entries;
    const merged = [...entries, ...orphans].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    await writeRevisionLog(directory, merged);
    return merged;
  });
}

/**
 * Carry a path's revision history to another path (rename). Revision files
 * are content-addressed, so copying them is safe; entries the target already
 * knows are skipped.
 */
export async function copyArtifactRevisionHistory(chatId: string, from: string, to: string): Promise<void> {
  const source = artifactRevisionDirectory(chatId, from);
  const target = artifactRevisionDirectory(chatId, to);
  if (source === target) return;
  const entries = await withRevisionLogLock(source, () => readRevisionLog(source));
  if (entries.length === 0) return;
  await withRevisionLogLock(target, async () => {
    const existing = await readRevisionLog(target);
    const known = new Set(existing.map((entry) => entry.revision));
    const additions: ArtifactRevisionEntry[] = [];
    for (const entry of entries) {
      if (known.has(entry.revision)) continue;
      const stored = await readJson<StoredArtifactRevision>(
        `${source}/${encodeURIComponent(entry.revision)}.json`,
      ).catch(() => undefined);
      if (!stored) continue;
      await writeJson(`${target}/${encodeURIComponent(entry.revision)}.json`, { ...stored, path: to });
      additions.push(entry);
    }
    if (additions.length === 0) return;
    await writeRevisionLog(target, [...existing, ...additions]);
  });
}

// ============================================================================
// Artifacts Storage (stored as real files within chat folders)
// ============================================================================

/**
 * Write an artifact file to a chat's artifacts folder.
 */
export async function writeArtifact(
  chatId: string,
  path: string,
  content: string,
  contentType?: string,
): Promise<void> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    throw new Error("Artifact path is required");
  }
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;

  if (content.startsWith("data:")) {
    await writeBlob(fullPath, contentToBlob(content, contentType));
    return;
  }

  if (isBinaryContentType(contentType)) {
    await writeBlob(fullPath, contentToBlob(content, contentType));
    return;
  }

  await writeText(fullPath, content, contentType ?? inferContentType(path) ?? "text/plain;charset=utf-8");
}

/**
 * Read an artifact file from a chat's artifacts folder.
 */
export async function readArtifact(
  chatId: string,
  path: string,
): Promise<{ content: string; contentType?: string } | undefined> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    return undefined;
  }
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;

  const blob = await readBlob(fullPath);
  if (!blob) {
    return undefined;
  }

  // Prefer our own inference over blob.type — OPFS doesn't preserve the
  // MIME type we wrote; the browser re-infers it from the filename and may
  // return legacy types (e.g. "application/x-javascript") that our
  // isTextContentType check doesn't recognise, causing text files to be
  // round-tripped through readAsDataURL and surfaced as data-URLs.
  const contentType = inferContentType(path) || blob.type;

  if (isBinaryContentType(contentType)) {
    return { content: await blobToDataUrl(blob, contentType), contentType };
  }

  // Blob.text() strips a UTF-8 BOM. File tools must preserve it when editing.
  const content = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
  return { content, contentType };
}

/**
 * Delete an artifact file from a chat's artifacts folder.
 */
export async function deleteArtifact(chatId: string, path: string): Promise<void> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    return;
  }
  await deleteFile(`chats/${chatId}/artifacts/${normalizedPath}`);
}

/**
 * Delete a folder of artifacts from a chat's artifacts folder.
 */
export async function deleteArtifactFolder(chatId: string, path: string): Promise<void> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    return;
  }
  await deleteDirectory(`chats/${chatId}/artifacts/${normalizedPath}`);
}

/**
 * List all artifact files in a chat's artifacts folder.
 * Returns paths relative to the artifacts folder.
 */
export async function listArtifacts(chatId: string): Promise<string[]> {
  const artifacts: string[] = [];

  async function scanDirectory(dirPath: string): Promise<void> {
    const fullDirPath = `chats/${chatId}/artifacts${dirPath ? `/${dirPath}` : ""}`;

    try {
      const files = await listFiles(fullDirPath);
      for (const file of files) {
        const relativePath = dirPath ? `${dirPath}/${file}` : file;
        artifacts.push(`/${relativePath}`);
      }

      const dirs = await listDirectories(fullDirPath);
      for (const dir of dirs) {
        const relativePath = dirPath ? `${dirPath}/${dir}` : dir;
        await scanDirectory(relativePath);
      }
    } catch {
      // Directory doesn't exist
    }
  }

  await scanDirectory("");
  return artifacts;
}

/**
 * List all artifact entries in a chat's artifacts folder.
 * Returns relative paths with metadata without loading file content.
 */
export async function listArtifactEntries(chatId: string): Promise<ArtifactEntry[]> {
  const artifacts: ArtifactEntry[] = [];

  async function scanDirectory(dirPath: string): Promise<void> {
    const fullDirPath = `chats/${chatId}/artifacts${dirPath ? `/${dirPath}` : ""}`;

    try {
      const files = await listFiles(fullDirPath);
      for (const file of files) {
        const relativePath = dirPath ? `${dirPath}/${file}` : file;
        const path = `/${relativePath}`;
        const metadata = await readFileMetadata(`chats/${chatId}/artifacts/${relativePath}`);

        artifacts.push({
          path,
          contentType: metadata?.contentType ?? inferContentType(path),
          size: metadata?.size ?? 0,
          lastModified: metadata?.lastModified,
        });
      }

      const dirs = await listDirectories(fullDirPath);
      for (const dir of dirs) {
        const relativePath = dirPath ? `${dirPath}/${dir}` : dir;
        await scanDirectory(relativePath);
      }
    } catch {
      // Directory doesn't exist
    }
  }

  await scanDirectory("");
  return artifacts;
}

/**
 * Load all artifacts for a chat as a FileSystem object.
 */
export async function loadArtifacts(
  chatId: string,
): Promise<Record<string, { path: string; content: string; contentType?: string }>> {
  const paths = await listArtifacts(chatId);
  const artifacts: Record<string, { path: string; content: string; contentType?: string }> = {};

  for (const path of paths) {
    const data = await readArtifact(chatId, path);
    if (data) {
      artifacts[path] = { path, content: data.content, contentType: data.contentType };
    }
  }

  return artifacts;
}

/**
 * Save all artifacts from a FileSystem object to OPFS.
 */
export async function saveArtifacts(
  chatId: string,
  artifacts: Record<string, { path: string; content: string; contentType?: string }>,
): Promise<void> {
  for (const [path, file] of Object.entries(artifacts)) {
    await writeArtifact(chatId, path, file.content, file.contentType);
  }
}
