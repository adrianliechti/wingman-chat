/**
 * OPFS Artifacts — Artifact file CRUD within chat folders.
 */

import { artifactContentToBlob, normalizeArtifactPath } from './artifactFiles';
import { isBinaryContentType } from './fileTypes';

import {
  writeText, writeBlob, readBlob, deleteFile, deleteDirectory,
  listFiles, listDirectories,
  inferContentType, readFileMetadata,
} from './opfs-core';
import { readAsDataURL } from './utils';

export interface ArtifactEntry {
  path: string;
  contentType?: string;
  size: number;
}

// ============================================================================
// Artifacts Storage (stored as real files within chat folders)
// ============================================================================

/**
 * Write an artifact file to a chat's artifacts folder.
 */
export async function writeArtifact(chatId: string, path: string, content: string, contentType?: string): Promise<void> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    throw new Error('Artifact path is required');
  }
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;

  if (content.startsWith('data:')) {
    await writeBlob(fullPath, artifactContentToBlob(content, contentType));
    return;
  }

  if (isBinaryContentType(contentType)) {
    await writeBlob(fullPath, artifactContentToBlob(content, contentType));
    return;
  }

  await writeText(fullPath, content, contentType ?? inferContentType(path) ?? 'text/plain;charset=utf-8');
}

/**
 * Read an artifact file from a chat's artifacts folder.
 */
export async function readArtifact(chatId: string, path: string): Promise<{ content: string; contentType?: string } | undefined> {
  const normalizedPath = normalizeArtifactPath(path)?.slice(1);
  if (!normalizedPath) {
    return undefined;
  }
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;

  const blob = await readBlob(fullPath);
  if (!blob) {
    return undefined;
  }

  const contentType = blob.type || inferContentType(path);

  if (isBinaryContentType(contentType)) {
    return { content: await readAsDataURL(blob), contentType };
  }

  return { content: await blob.text(), contentType };
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
    const fullDirPath = `chats/${chatId}/artifacts${dirPath ? '/' + dirPath : ''}`;
    
    try {
      const files = await listFiles(fullDirPath);
      for (const file of files) {
        const relativePath = dirPath ? `${dirPath}/${file}` : file;
        artifacts.push('/' + relativePath);
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
  
  await scanDirectory('');
  return artifacts;
}

/**
 * List all artifact entries in a chat's artifacts folder.
 * Returns relative paths with metadata without loading file content.
 */
export async function listArtifactEntries(chatId: string): Promise<ArtifactEntry[]> {
  const artifacts: ArtifactEntry[] = [];

  async function scanDirectory(dirPath: string): Promise<void> {
    const fullDirPath = `chats/${chatId}/artifacts${dirPath ? '/' + dirPath : ''}`;

    try {
      const files = await listFiles(fullDirPath);
      for (const file of files) {
        const relativePath = dirPath ? `${dirPath}/${file}` : file;
        const path = '/' + relativePath;
        const metadata = await readFileMetadata(`chats/${chatId}/artifacts/${relativePath}`);

        artifacts.push({
          path,
          contentType: metadata?.contentType ?? inferContentType(path),
          size: metadata?.size ?? 0,
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

  await scanDirectory('');
  return artifacts;
}

/**
 * Load all artifacts for a chat as a FileSystem object.
 */
export async function loadArtifacts(chatId: string): Promise<Record<string, { path: string; content: string; contentType?: string }>> {
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
  artifacts: Record<string, { path: string; content: string; contentType?: string }>
): Promise<void> {
  for (const [path, file] of Object.entries(artifacts)) {
    await writeArtifact(chatId, path, file.content, file.contentType);
  }
}
