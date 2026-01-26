import JSZip from 'jszip';
import { downloadBlob } from './utils';
import * as opfs from './opfs';
import type { File } from '../types/file';

type FileEventType = 'fileCreated' | 'fileDeleted' | 'fileRenamed' | 'fileUpdated';

type FileEventHandler<T extends FileEventType> = T extends 'fileCreated'
  ? (path: string) => void
  : T extends 'fileDeleted'
  ? (path: string) => void
  : T extends 'fileRenamed'
  ? (oldPath: string, newPath: string) => void
  : T extends 'fileUpdated'
  ? (path: string) => void
  : never;

/**
 * FileSystemManager - OPFS-backed file system for artifacts
 * 
 * All operations go directly to OPFS. Events are emitted synchronously
 * after OPFS operations complete to notify UI of changes.
 */
export class FileSystemManager {
  private eventHandlers = new Map<FileEventType, Set<(...args: unknown[]) => void>>();
  private _chatId: string | null = null;

  constructor() {
    // Initialize event handler sets
    this.eventHandlers.set('fileCreated', new Set());
    this.eventHandlers.set('fileDeleted', new Set());
    this.eventHandlers.set('fileRenamed', new Set());
    this.eventHandlers.set('fileUpdated', new Set());
  }

  // Get the current chat ID
  get chatId(): string | null {
    return this._chatId;
  }

  // Check if filesystem is ready (has a chat ID set)
  get isReady(): boolean {
    return this._chatId !== null;
  }

  // Set the current chat ID (called when switching chats)
  setChatId(chatId: string | null): void {
    this._chatId = chatId;
  }

  // Event subscription methods
  subscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): () => void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.add(handler as (...args: unknown[]) => void);
    }

    // Return unsubscribe function
    return () => this.unsubscribe(eventType, handler);
  }

  unsubscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as (...args: unknown[]) => void);
    }
  }

  private emit(eventType: FileEventType, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error);
        }
      });
    }
  }

  /**
   * Create a new file or update an existing file.
   * Writes directly to OPFS, then emits event.
   */
  async createFile(path: string, content: string, contentType?: string): Promise<void> {
    if (!this._chatId) {
      throw new Error('No chat ID set - cannot create file');
    }

    // Check if file exists to determine event type
    const existingFile = await opfs.readArtifact(this._chatId, path);
    const isUpdate = existingFile !== undefined;

    // Write to OPFS
    await opfs.writeArtifact(this._chatId, path, content, contentType);

    // Emit event synchronously after write completes
    if (isUpdate) {
      this.emit('fileUpdated', path);
    } else {
      this.emit('fileCreated', path);
    }
  }

  /**
   * Delete a file or folder. Returns true if something was deleted.
   */
  async deleteFile(path: string): Promise<boolean> {
    if (!this._chatId) {
      return false;
    }

    // Check if this is a file
    const file = await opfs.readArtifact(this._chatId, path);
    if (file) {
      await opfs.deleteArtifact(this._chatId, path);
      this.emit('fileDeleted', path);
      return true;
    }

    // Check if this is a folder (has files that start with path + '/')
    const allFiles = await opfs.listArtifacts(this._chatId);
    const affectedFiles = allFiles.filter(f => f.startsWith(path + '/'));

    if (affectedFiles.length > 0) {
      // Delete the folder and all contents
      await opfs.deleteArtifactFolder(this._chatId, path);
      
      // Emit event for each deleted file
      for (const filePath of affectedFiles) {
        this.emit('fileDeleted', filePath);
      }
      return true;
    }

    return false;
  }

  /**
   * Rename/move a file or folder. Returns true on success.
   */
  async renameFile(oldPath: string, newPath: string): Promise<boolean> {
    if (!this._chatId) {
      return false;
    }

    // Check if source is a file
    const file = await opfs.readArtifact(this._chatId, oldPath);
    if (file) {
      // Check if destination already exists
      const destFile = await opfs.readArtifact(this._chatId, newPath);
      if (destFile) {
        return false;
      }

      // Copy content to new location and delete old
      await opfs.writeArtifact(this._chatId, newPath, file.content, file.contentType);
      await opfs.deleteArtifact(this._chatId, oldPath);
      this.emit('fileRenamed', oldPath, newPath);
      return true;
    }

    // Check if source is a folder
    const allFiles = await opfs.listArtifacts(this._chatId);
    const affectedFiles = allFiles.filter(f => f.startsWith(oldPath + '/'));

    if (affectedFiles.length > 0) {
      // Rename all files in the folder
      for (const filePath of affectedFiles) {
        const relativePath = filePath.substring(oldPath.length);
        const newFilePath = newPath + relativePath;
        
        const fileData = await opfs.readArtifact(this._chatId, filePath);
        if (fileData) {
          await opfs.writeArtifact(this._chatId, newFilePath, fileData.content, fileData.contentType);
          await opfs.deleteArtifact(this._chatId, filePath);
          this.emit('fileRenamed', filePath, newFilePath);
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Get a file by path. Returns undefined if not found.
   */
  async getFile(path: string): Promise<File | undefined> {
    if (!this._chatId) {
      return undefined;
    }

    const data = await opfs.readArtifact(this._chatId, path);
    if (!data) {
      return undefined;
    }

    return {
      path,
      content: data.content,
      contentType: data.contentType,
    };
  }

  /**
   * List all files in the filesystem.
   */
  async listFiles(): Promise<File[]> {
    if (!this._chatId) {
      return [];
    }

    const paths = await opfs.listArtifacts(this._chatId);
    const files: File[] = [];

    for (const path of paths) {
      const data = await opfs.readArtifact(this._chatId, path);
      if (data) {
        files.push({
          path,
          content: data.content,
          contentType: data.contentType,
        });
      }
    }

    return files;
  }

  /**
   * Check if a file exists at the given path.
   */
  async fileExists(path: string): Promise<boolean> {
    if (!this._chatId) {
      return false;
    }

    const data = await opfs.readArtifact(this._chatId, path);
    return data !== undefined;
  }

  /**
   * Get the number of files in the filesystem.
   */
  async getFileCount(): Promise<number> {
    if (!this._chatId) {
      return 0;
    }

    const paths = await opfs.listArtifacts(this._chatId);
    return paths.length;
  }

  /**
   * Download all files as a zip archive.
   */
  async downloadAsZip(filename?: string): Promise<void> {
    const files = await this.listFiles();
    const filesystem: Record<string, File> = {};
    for (const file of files) {
      filesystem[file.path] = file;
    }
    return downloadFilesystemAsZip(filesystem, filename);
  }
}

export async function downloadFilesystemAsZip(
  filesystem: Record<string, File>, 
  filename: string = 'filesystem.zip'
): Promise<void> {
  if (Object.keys(filesystem).length === 0) {
    throw new Error('No files to download');
  }

  const zip = new JSZip();

  // Add each file to the zip
  for (const [path, file] of Object.entries(filesystem)) {
    // Remove leading slash if present for cleaner zip structure
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    
    // Add file to zip with its content
    zip.file(cleanPath, file.content);
  }

  try {
    // Generate the zip file as a blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Download the zip file
    downloadBlob(zipBlob, filename);
  } catch (error) {
    throw new Error(`Failed to create zip file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}