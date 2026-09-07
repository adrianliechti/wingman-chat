/**
 * OPFS Artifacts — Artifact file CRUD within chat folders.
 */

import { contentToBlob } from "./fileContent";
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
}

function artifactRevisionPath(chatId: string, path: string, revision: string): string {
  const encodedPath = encodeURIComponent(normalizeArtifactPath(path) ?? path);
  const encodedRevision = encodeURIComponent(revision);
  return `chats/${chatId}/artifact-versions/${encodedPath}/${encodedRevision}.json`;
}

export async function archiveArtifactRevision(chatId: string, revision: StoredArtifactRevision): Promise<void> {
  await writeJson(artifactRevisionPath(chatId, revision.path, revision.revision), revision);
}

export async function loadArtifactRevision(
  chatId: string,
  path: string,
  revision: string,
): Promise<StoredArtifactRevision | undefined> {
  return readJson<StoredArtifactRevision>(artifactRevisionPath(chatId, path, revision));
}

export async function listArtifactRevisions(chatId: string, path: string): Promise<string[]> {
  const encodedPath = encodeURIComponent(normalizeArtifactPath(path) ?? path);
  const files = await listFiles(`chats/${chatId}/artifact-versions/${encodedPath}`);
  return files.filter((file) => file.endsWith(".json")).map((file) => decodeURIComponent(file.slice(0, -5)));
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
