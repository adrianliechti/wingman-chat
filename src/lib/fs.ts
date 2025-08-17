import JSZip from 'jszip';
import { downloadBlob } from './utils';
import type { FileSystem, File } from '../types/file';

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

// FileSystem extension methods
export class FileSystemManager {
  private eventHandlers = new Map<FileEventType, Set<(...args: unknown[]) => void>>();
  private cachedFileSystem: FileSystem = {}; // Local cache to avoid React state delays

  constructor(
    private getFilesystem: () => FileSystem,
    private setFilesystem: (fs: (current: FileSystem) => FileSystem) => void
  ) {
    // Initialize event handler sets
    this.eventHandlers.set('fileCreated', new Set());
    this.eventHandlers.set('fileDeleted', new Set());
    this.eventHandlers.set('fileRenamed', new Set());
    this.eventHandlers.set('fileUpdated', new Set());
  }

  // Update the filesystem getter and setter functions
  updateHandlers(
    getFilesystem: (() => FileSystem) | null,
    setFilesystem: ((fs: (current: FileSystem) => FileSystem) => void) | null
  ): void {
    if (getFilesystem && setFilesystem) {
      this.getFilesystem = getFilesystem;
      this.setFilesystem = setFilesystem;
      // Initialize cache with current filesystem state
      this.cachedFileSystem = getFilesystem();
    } else {
      // Clear handlers when no chat or artifacts disabled
      this.getFilesystem = () => ({});
      this.setFilesystem = () => {}; // No-op when disabled
      this.cachedFileSystem = {};
    }
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

  createFile(path: string, content: string, contentType?: string): void {
    // Check if file already exists to determine the correct event type
    const fileExists = path in this.cachedFileSystem;
    
    const file: File = {
      path,
      content,
      contentType,
    };

    // Update cache immediately to avoid React state delays
    this.cachedFileSystem = {
      ...this.cachedFileSystem,
      [path]: file
    };

    // Persist to React state
    this.setFilesystem((fs: FileSystem) => ({
      ...fs,
      [path]: file
    }));
    
    // Emit the appropriate event based on whether the file existed
    if (fileExists) {
      this.emit('fileUpdated', path);
    } else {
      this.emit('fileCreated', path);
    }
  }

  updateFile(path: string, content: string, contentType?: string): boolean {
    const existingFile = this.cachedFileSystem[path];
    if (!existingFile) return false;

    const updatedFile = {
      ...existingFile,
      content,
      contentType,
    };

    // Update cache immediately
    this.cachedFileSystem = {
      ...this.cachedFileSystem,
      [path]: updatedFile
    };

    // Persist to React state
    this.setFilesystem((fs: FileSystem) => ({
      ...fs,
      [path]: updatedFile
    }));
    
    // Emit the event immediately since we have the updated file in cache
    queueMicrotask(() => {
      this.emit('fileUpdated', path);
    });
    return true;
  }

  deleteFile(path: string): boolean {
    // Check if this is a direct file
    const isFile = this.cachedFileSystem[path];
    
    if (isFile) {
      // Handle single file deletion - update cache immediately
      const newCache = { ...this.cachedFileSystem };
      delete newCache[path];
      this.cachedFileSystem = newCache;

      // Persist to React state
      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        delete newFs[path];
        return newFs;
      });
      
      // Emit the event immediately since we updated the cache
      queueMicrotask(() => {
        this.emit('fileDeleted', path);
      });
      return true;
    }

    // Check if this is a folder (has files that start with path + '/')
    const affectedFiles = this.listFiles().filter(file => 
      file.path.startsWith(path + '/')
    );

    if (affectedFiles.length > 0) {
      // Handle folder deletion - update cache immediately
      const newCache = { ...this.cachedFileSystem };
      for (const file of affectedFiles) {
        delete newCache[file.path];
      }
      this.cachedFileSystem = newCache;

      // Persist to React state
      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        for (const file of affectedFiles) {
          delete newFs[file.path];
        }
        return newFs;
      });
      
      // Emit the events immediately since we updated the cache
      queueMicrotask(() => {
        // Call the emit for each deleted file
        for (const file of affectedFiles) {
          this.emit('fileDeleted', file.path);
        }
      });
      
      return true;
    }

    // Path doesn't exist as file or folder
    return false;
  }

  renameFile(oldPath: string, newPath: string): boolean {
    const filesystem = this.getFilesystem();
    // Check if the old path exists (either as a file or folder)
    const isFile = filesystem[oldPath];
    const isFolder = this.listFiles().some(file => file.path.startsWith(oldPath + '/'));
    
    if (!isFile && !isFolder) {
      return false; // Path doesn't exist
    }

    if (filesystem[newPath]) {
      return false; // New path already exists
    }

    if (isFile) {
      // Handle file rename
      const file = filesystem[oldPath];
      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        newFs[newPath] = {
          ...file,
          path: newPath,
        };
        delete newFs[oldPath];
        return newFs;
      });
      
      this.emit('fileRenamed', oldPath, newPath);
      return true;
    } else if (isFolder) {
      // Handle folder rename - rename all files within the folder
      const affectedFiles = this.listFiles().filter(file => 
        file.path.startsWith(oldPath + '/')
      );

      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        for (const file of affectedFiles) {
          const relativePath = file.path.substring(oldPath.length);
          const newFilePath = newPath + relativePath;
          
          newFs[newFilePath] = {
            ...file,
            path: newFilePath,
          };
          delete newFs[file.path];
        }
        return newFs;
      });
      
      // Call the emit for each renamed file
      for (const file of affectedFiles) {
        const relativePath = file.path.substring(oldPath.length);
        const newFilePath = newPath + relativePath;
        this.emit('fileRenamed', file.path, newFilePath);
      }
      
      return true;
    }

    return false;
  }

  getFile(path: string): File | undefined {
    return this.cachedFileSystem[path];
  }

  listFiles(): File[] {
    return Object.values(this.cachedFileSystem);
  }

  fileExists(path: string): boolean {
    return path in this.cachedFileSystem;
  }

  getFileCount(): number {
    return Object.keys(this.cachedFileSystem).length;
  }

  async downloadAsZip(filename?: string): Promise<void> {
    return downloadFilesystemAsZip(this.cachedFileSystem, filename);
  }
}

export async function downloadFilesystemAsZip(
  filesystem: FileSystem, 
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