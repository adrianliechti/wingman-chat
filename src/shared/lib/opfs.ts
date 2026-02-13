/**
 * OPFS (Origin Private File System) Storage Layer
 * 
 * Provides file-based storage using the browser's OPFS API.
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
 *   /bridge.json              # Bridge server config
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
 * Get or create a directory handle at the given path.
 * Creates parent directories as needed.
 */
export async function getDirectory(path: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  const parts = path.split('/').filter(Boolean);
  
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  
  return current;
}

/**
 * Write JSON data to a file.
 */
export async function writeJson<T>(path: string, data: T): Promise<void> {
  const json = JSON.stringify(data);
  await writeText(path, json);
}

/**
 * Write text data to a file.
 */
export async function writeText(path: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: 'application/json' });
  await writeBlob(path, blob);
}

/**
 * Write binary data to a file.
 * Uses FileSystemWritableFileStream for Safari compatibility.
 */
export async function writeBlob(path: string, blob: Blob): Promise<void> {
  const { dir, name } = parsePath(path);
  const directory = await getDirectory(dir);
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
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
      if (handle.kind === 'file') {
        files.push(name);
      }
    }
    
    return files;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
      if (handle.kind === 'directory') {
        dirs.push(name);
      }
    }
    
    return dirs;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) {
      // Can't delete root
      return;
    }
    
    const parentPath = parts.slice(0, -1).join('/');
    const dirName = parts[parts.length - 1];
    
    const parent = parentPath ? await getDirectory(parentPath) : await getRoot();
    await parent.removeEntry(dirName, { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
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
export async function upsertIndexEntry(
  collection: string, 
  entry: IndexEntry
): Promise<void> {
  const index = await readIndex(collection);
  const existingIdx = index.findIndex(e => e.id === entry.id);
  
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
  const filtered = index.filter(e => e.id !== id);
  await writeIndex(collection, filtered);
}

/**
 * Rebuild an index by scanning all files in the collection.
 * The extractMeta function should extract id, title, and updated from the data.
 */
export async function rebuildIndex<T>(
  collection: string,
  extractMeta: (data: T) => IndexEntry
): Promise<IndexEntry[]> {
  const files = await listFiles(collection);
  const entries: IndexEntry[] = [];
  
  for (const file of files) {
    if (file === 'index.json') continue;
    
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
      
      if (entryHandle.kind === 'file') {
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
  await scanDirectory('', root);
  
  return { totalSize, entries };
}

// ============================================================================
// Co-located Blob Storage (blobs stored within their parent entity folder)
// ============================================================================

/**
 * Store a blob in a chat's blobs folder and return its ID.
 */
export async function storeChatBlob(chatId: string, blob: Blob): Promise<string> {
  const blobId = crypto.randomUUID();
  await writeBlob(`chats/${chatId}/blobs/${blobId}.bin`, blob);
  return blobId;
}

/**
 * Retrieve a blob from a chat's blobs folder by ID.
 */
export async function getChatBlob(chatId: string, blobId: string): Promise<Blob | undefined> {
  return readBlob(`chats/${chatId}/blobs/${blobId}.bin`);
}

/**
 * Delete a blob from a chat's blobs folder.
 */
export async function deleteChatBlob(chatId: string, blobId: string): Promise<void> {
  await deleteFile(`chats/${chatId}/blobs/${blobId}.bin`);
}

/**
 * List all blob IDs in a chat's blobs folder.
 */
export async function listChatBlobs(chatId: string): Promise<string[]> {
  const files = await listFiles(`chats/${chatId}/blobs`);
  return files.map(f => f.replace(/\.bin$/, ''));
}

// Legacy central blob storage (for migration compatibility)
/**
 * Store a blob and return its ID.
 * @deprecated Use storeChatBlob for new storage
 */
export async function storeBlob(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await writeBlob(`blobs/${id}.bin`, blob);
  return id;
}

/**
 * Retrieve a blob by ID.
 * @deprecated Use getChatBlob for new storage
 */
export async function getBlob(id: string): Promise<Blob | undefined> {
  return readBlob(`blobs/${id}.bin`);
}

/**
 * Delete a blob by ID.
 * @deprecated Use deleteChatBlob for new storage
 */
export async function deleteBlob(id: string): Promise<void> {
  await deleteFile(`blobs/${id}.bin`);
}

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

/**
 * Infer content type from file path extension.
 */
function inferContentType(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'text/javascript',
    'jsx': 'text/javascript',
    'ts': 'text/typescript',
    'tsx': 'text/typescript',
    'json': 'application/json',
    'md': 'text/markdown',
    'txt': 'text/plain',
    'svg': 'image/svg+xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'xml': 'application/xml',
    'yaml': 'application/yaml',
    'yml': 'application/yaml',
    'csv': 'text/csv',
    'py': 'text/x-python',
    'rb': 'text/x-ruby',
    'go': 'text/x-go',
    'rs': 'text/x-rust',
    'java': 'text/x-java',
    'c': 'text/x-c',
    'cpp': 'text/x-c++',
    'h': 'text/x-c',
    'hpp': 'text/x-c++',
  };
  return ext ? contentTypes[ext] : undefined;
}

// ============================================================================
// Data URL / Blob Conversion Utilities
// ============================================================================

/**
 * Convert a data URL to a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
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
  return str.startsWith('data:');
}

/**
 * Check if a string is a blob reference (path to blob storage).
 */
export function isBlobRef(str: string): boolean {
  return str.startsWith('blob:');
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
  if (!ref.startsWith('blob:')) {
    return null;
  }
  return ref.slice(5);
}

// ============================================================================
// Message Blob Extraction and Rehydration (Chat-scoped)
// ============================================================================

import type { Content, Message, Chat, ImageContent, AudioContent, FileContent, ToolResultContent } from '@/shared/types/chat';

/** Content part with blob reference instead of data URL */
export type BlobRefImageContent = Omit<ImageContent, 'data'> & { data: string }; // data is blob:id
export type BlobRefAudioContent = Omit<AudioContent, 'data'> & { data: string };
export type BlobRefFileContent = Omit<FileContent, 'data'> & { data: string };

export type StoredContent = 
  | Exclude<Content, ImageContent | AudioContent | FileContent | ToolResultContent>
  | BlobRefImageContent 
  | BlobRefAudioContent 
  | BlobRefFileContent
  | (Omit<ToolResultContent, 'result'> & { result: StoredContent[] });

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: StoredContent[];
  error?: { code: string; message: string } | null;
}

export interface StoredChat {
  id: string;
  title?: string;
  created: string | null;
  updated: string | null;
  model: Chat['model'];
  messages: StoredMessage[];
}

/**
 * Extract binary data from a content part and store as blob in chat folder.
 * Returns the content with data URL replaced by blob reference.
 */
async function extractContentBlobForChat(chatId: string, content: Content): Promise<StoredContent> {
  if (content.type === 'image' || content.type === 'audio' || content.type === 'file') {
    if (isDataUrl(content.data)) {
      const blob = dataUrlToBlob(content.data);
      const blobId = await storeChatBlob(chatId, blob);
      return { ...content, data: createBlobRef(blobId) };
    }
    // Already a blob ref or other format, keep as-is
    return content as StoredContent;
  }
  
  if (content.type === 'tool_result') {
    const extractedResult = await Promise.all(
      content.result.map(r => extractContentBlobForChat(chatId, r as Content))
    );
    return { ...content, result: extractedResult } as StoredContent;
  }
  
  return content as StoredContent;
}

/**
 * Rehydrate a content part by loading blob data from chat folder and converting to data URL.
 */
async function rehydrateContentBlobForChat(chatId: string, content: StoredContent): Promise<Content> {
  if (content.type === 'image' || content.type === 'audio' || content.type === 'file') {
    const blobId = parseBlobRef(content.data);
    if (blobId) {
      // Try chat-scoped blob first
      let blob = await getChatBlob(chatId, blobId);
      
      // Fall back to legacy central blob storage (for migration)
      if (!blob) {
        blob = await getBlob(blobId);
      }
      
      if (blob) {
        const dataUrl = await blobToDataUrl(blob);
        return { ...content, data: dataUrl };
      }
      // Blob not found, return with empty data or placeholder
      console.warn(`Blob not found: ${blobId}`);
      return { ...content, data: '' };
    }
    // Not a blob ref, return as-is
    return content as Content;
  }
  
  if (content.type === 'tool_result') {
    const rehydratedResult = await Promise.all(
      content.result.map(r => rehydrateContentBlobForChat(chatId, r as StoredContent))
    );
    return { ...content, result: rehydratedResult } as Content;
  }
  
  return content as Content;
}

/**
 * Extract all binary data from a message and store as blobs in chat folder.
 */
export async function extractMessageBlobsForChat(chatId: string, message: Message): Promise<StoredMessage> {
  const extractedContent = await Promise.all(
    message.content.map(c => extractContentBlobForChat(chatId, c))
  );
  
  return {
    role: message.role,
    content: extractedContent,
    error: message.error,
  };
}

/**
 * Rehydrate all blob references in a message from chat folder.
 */
export async function rehydrateMessageBlobsForChat(chatId: string, message: StoredMessage): Promise<Message> {
  const rehydratedContent = await Promise.all(
    message.content.map(c => rehydrateContentBlobForChat(chatId, c))
  );
  
  return {
    role: message.role,
    content: rehydratedContent,
    error: message.error,
  };
}

/**
 * Extract all binary data from a chat and store as blobs in chat folder.
 * Returns a StoredChat suitable for JSON serialization.
 * Note: Artifacts should be saved separately via saveArtifacts().
 */
export async function extractChatBlobs(chat: Chat): Promise<StoredChat> {
  const extractedMessages = await Promise.all(
    chat.messages.map(m => extractMessageBlobsForChat(chat.id, m))
  );
  
  return {
    id: chat.id,
    title: chat.title,
    created: chat.created instanceof Date ? chat.created.toISOString() : (chat.created as unknown as string || null),
    updated: chat.updated instanceof Date ? chat.updated.toISOString() : (chat.updated as unknown as string || null),
    model: chat.model,
    messages: extractedMessages,
  };
}

/**
 * Rehydrate all blob references in a stored chat.
 * Returns a Chat with all data URLs restored.
 * Note: Artifacts should be loaded separately via loadArtifacts().
 */
export async function rehydrateChatBlobs(stored: StoredChat): Promise<Chat> {
  const rehydratedMessages = await Promise.all(
    stored.messages.map(m => rehydrateMessageBlobsForChat(stored.id, m))
  );
  
  return {
    id: stored.id,
    title: stored.title,
    created: stored.created ? new Date(stored.created) : null,
    updated: stored.updated ? new Date(stored.updated) : null,
    model: stored.model,
    messages: rehydratedMessages,
  };
}

/**
 * Collect all blob IDs referenced in a stored message.
 */
function collectMessageBlobIds(message: StoredMessage): string[] {
  const ids: string[] = [];
  
  function collectFromContent(content: StoredContent): void {
    if (content.type === 'image' || content.type === 'audio' || content.type === 'file') {
      const blobId = parseBlobRef(content.data);
      if (blobId) {
        ids.push(blobId);
      }
    } else if (content.type === 'tool_result') {
      content.result.forEach(collectFromContent);
    }
  }
  
  message.content.forEach(collectFromContent);
  return ids;
}

/**
 * Collect all blob IDs referenced in a stored chat.
 */
export function collectChatBlobIds(chat: StoredChat): string[] {
  const ids: string[] = [];
  for (const message of chat.messages) {
    ids.push(...collectMessageBlobIds(message));
  }
  return ids;
}

// ============================================================================
// Skills Storage (agentskills.io compatible SKILL.md format)
// ============================================================================

import type { Skill } from '@/features/settings/lib/skillParser';
import { parseSkillFile } from '@/features/settings/lib/skillParser';

export interface StoredSkill {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
}

/**
 * Save a skill as SKILL.md in /skills/{name}/ folder.
 */
export async function saveSkill(skill: Skill): Promise<void> {
  const skillContent = serializeSkillWithEnabled(skill);
  await writeText(`skills/${skill.name}/SKILL.md`, skillContent);
  
  // Update index
  await upsertIndexEntry('skills', {
    id: skill.id,
    title: skill.name,
    updated: new Date().toISOString(),
  });
}

/**
 * Load a skill from /skills/{name}/SKILL.md.
 */
export async function loadSkill(name: string): Promise<Skill | undefined> {
  const content = await readText(`skills/${name}/SKILL.md`);
  if (!content) {
    return undefined;
  }
  
  const result = parseSkillFileWithEnabled(content);
  if (!result.success) {
    console.warn(`Failed to parse skill ${name}:`, result.errors);
    return undefined;
  }
  
  // Find ID from index or generate one
  const index = await readIndex('skills');
  const entry = index.find(e => e.title === name);
  
  return {
    id: entry?.id || crypto.randomUUID(),
    ...result.skill,
  };
}

/**
 * Delete a skill and its folder.
 */
export async function deleteSkill(name: string): Promise<void> {
  // Find ID from index for removal
  const index = await readIndex('skills');
  const entry = index.find(e => e.title === name);
  
  // Delete the folder
  await deleteDirectory(`skills/${name}`);
  
  // Update index
  if (entry) {
    await removeIndexEntry('skills', entry.id);
  }
}

/**
 * List all skill names.
 */
export async function listSkillNames(): Promise<string[]> {
  return listDirectories('skills');
}

/**
 * Load all skills.
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const names = await listSkillNames();
  const skills: Skill[] = [];
  
  for (const name of names) {
    const skill = await loadSkill(name);
    if (skill) {
      skills.push(skill);
    }
  }
  
  return skills;
}

/**
 * Serialize a skill to SKILL.md format with enabled flag in frontmatter.
 */
function serializeSkillWithEnabled(skill: Skill): string {
  const lines = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `enabled: ${skill.enabled}`,
    '---',
    '',
    skill.content
  ];
  
  return lines.join('\n');
}

/**
 * Parse a SKILL.md file content with enabled flag.
 */
function parseSkillFileWithEnabled(content: string): 
  { success: true; skill: { name: string; description: string; content: string; enabled: boolean } } | 
  { success: false; errors: Array<{ field: string; message: string }> } {
  
  const result = parseSkillFile(content);
  if (!result.success) {
    return result;
  }
  
  // Extract enabled flag from frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  let enabled = true; // Default to enabled
  
  if (frontmatterMatch) {
    const enabledMatch = frontmatterMatch[1].match(/^enabled:\s*(true|false)\s*$/m);
    if (enabledMatch) {
      enabled = enabledMatch[1] === 'true';
    }
  }
  
  return {
    success: true,
    skill: {
      ...result.skill,
      enabled,
    },
  };
}

// ============================================================================
// ZIP Export/Import
// ============================================================================

import JSZip from 'jszip';

/**
 * Export a specific folder from OPFS as a ZIP file.
 */
export async function exportFolderAsZip(folderPath: string): Promise<Blob> {
  const zip = new JSZip();
  
  async function addDirectoryToZip(
    handle: FileSystemDirectoryHandle, 
    zipFolder: JSZip
  ): Promise<void> {
    for await (const [name, entryHandle] of handle.entries()) {
      if (entryHandle.kind === 'file') {
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        zipFolder.file(name, arrayBuffer);
      } else {
        const dirHandle = entryHandle as FileSystemDirectoryHandle;
        const subFolder = zipFolder.folder(name)!;
        await addDirectoryToZip(dirHandle, subFolder);
      }
    }
  }
  
  try {
    const folderHandle = await getDirectory(folderPath);
    await addDirectoryToZip(folderHandle, zip);
  } catch {
    // Folder doesn't exist, return empty zip
  }
  
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Import data from a ZIP file into a specific folder in OPFS.
 * This will merge with existing data in that folder (not replace).
 * Automatically rebuilds the index for the folder after import.
 */
export async function importFolderFromZip(folderPath: string, zipBlob: Blob): Promise<void> {
  const zip = await JSZip.loadAsync(zipBlob);
  
  // Ensure base folder exists
  await getDirectory(folderPath);
  
  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    const fullPath = `${folderPath}/${relativePath}`;
    
    if (zipEntry.dir) {
      // Create directory
      await getDirectory(fullPath.replace(/\/$/, ''));
    } else {
      // Write file
      const content = await zipEntry.async('arraybuffer');
      const blob = new Blob([content]);
      await writeBlob(fullPath, blob);
    }
  }
  
  // Rebuild index for the imported folder
  await rebuildFolderIndex(folderPath);
}

/**
 * Rebuild the index for a folder-based collection by scanning its subdirectories.
 * This is for the new folder structure where each item is a folder with metadata inside.
 */
export async function rebuildFolderIndex(collection: string): Promise<void> {
  const entries: IndexEntry[] = [];
  
  try {
    const folderHandle = await getDirectory(collection);
    
    for await (const [name, entryHandle] of folderHandle.entries()) {
      // Skip the index file itself
      if (name === 'index.json') continue;
      
      if (entryHandle.kind === 'directory') {
        // Try to read metadata from the folder
        const id = name;
        let title = name;
        let updated = new Date().toISOString();
        
        // Try to read metadata file based on collection type
        const metadataFiles = [
          `${collection}/${id}/chat.json`,
          `${collection}/${id}/repository.json`,
          `${collection}/${id}/metadata.json`,
        ];
        
        for (const metaPath of metadataFiles) {
          try {
            const meta = await readJson<{ title?: string; name?: string; updated?: string; updatedAt?: string }>(metaPath);
            if (meta) {
              title = meta.title || meta.name || title;
              updated = meta.updated || meta.updatedAt || updated;
              break;
            }
          } catch {
            // Try next metadata file
          }
        }
        
        entries.push({ id, title, updated });
      }
    }
    
    // Write the rebuilt index
    await writeJson(`${collection}/index.json`, entries);
  } catch {
    // Folder doesn't exist, nothing to rebuild
  }
}

/**
 * Export a specific folder from OPFS and trigger download.
 */
export async function downloadFolderAsZip(folderPath: string, filename: string): Promise<void> {
  const blob = await exportFolderAsZip(folderPath);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a path into directory and filename.
 */
function parsePath(path: string): { dir: string; name: string } {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid path: empty');
  }
  
  const name = parts.pop()!;
  const dir = parts.join('/');
  
  return { dir, name };
}
