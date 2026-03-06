/**
 * OPFS Artifacts — Artifact file CRUD within chat folders.
 */

import {
  writeText, writeBlob, readText, deleteFile, deleteDirectory,
  listFiles, listDirectories,
  dataUrlToBlob, inferContentType,
} from './opfs-core';

// ============================================================================
// Artifacts Storage (stored as real files within chat folders)
// ============================================================================

/**
 * Write an artifact file to a chat's artifacts folder.
 */
export async function writeArtifact(chatId: string, path: string, content: string, contentType?: string): Promise<void> {
  // Normalize path - remove leading slash if present
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;
  
  // Determine how to write based on content type
  if (contentType && (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream'))) {
    // Binary content - base64 decode if needed
    if (content.startsWith('data:')) {
      const blob = dataUrlToBlob(content);
      await writeBlob(fullPath, blob);
    } else {
      await writeText(fullPath, content);
    }
  } else {
    await writeText(fullPath, content);
  }
}

/**
 * Read an artifact file from a chat's artifacts folder.
 */
export async function readArtifact(chatId: string, path: string): Promise<{ content: string; contentType?: string } | undefined> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const fullPath = `chats/${chatId}/artifacts/${normalizedPath}`;
  
  const content = await readText(fullPath);
  if (content === undefined) {
    return undefined;
  }
  
  // Infer content type from extension
  const contentType = inferContentType(path);
  
  return { content, contentType };
}

/**
 * Delete an artifact file from a chat's artifacts folder.
 */
export async function deleteArtifact(chatId: string, path: string): Promise<void> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  await deleteFile(`chats/${chatId}/artifacts/${normalizedPath}`);
}

/**
 * Delete a folder of artifacts from a chat's artifacts folder.
 */
export async function deleteArtifactFolder(chatId: string, path: string): Promise<void> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
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
