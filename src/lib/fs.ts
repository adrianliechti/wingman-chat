import JSZip from 'jszip';
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
  private eventHandlers: Map<FileEventType, Set<(...args: unknown[]) => void>> = new Map();
  private version: number = 0; // Track filesystem version for React state management

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

  // Get current filesystem version for React state tracking
  get filesystemVersion(): number {
    return this.version;
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
    const file: File = {
      path,
      content,
      contentType,
    };

    // Use functional update to avoid stale closure issues
    this.setFilesystem((fs: FileSystem) => ({
      ...fs,
      [path]: file
    }));
    this.version++; // Increment version after filesystem change
    this.emit('fileCreated', path);
  }

  updateFile(path: string, content: string, contentType?: string): boolean {
    const filesystem = this.getFilesystem();
    const existingFile = filesystem[path];
    if (!existingFile) return false;

    this.setFilesystem((fs: FileSystem) => ({
      ...fs,
      [path]: {
        ...existingFile,
        content,
        contentType,
      }
    }));
    this.version++; // Increment version after filesystem change
    this.emit('fileUpdated', path);
    return true;
  }

  deleteFile(path: string): boolean {
    const filesystem = this.getFilesystem();
    // Check if this is a direct file
    const isFile = filesystem[path];
    
    if (isFile) {
      // Handle single file deletion
      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        delete newFs[path];
        return newFs;
      });
      this.version++; // Increment version after filesystem change
      this.emit('fileDeleted', path);
      return true;
    }

    // Check if this is a folder (has files that start with path + '/')
    const affectedFiles = this.listFiles().filter(file => 
      file.path.startsWith(path + '/')
    );

    if (affectedFiles.length > 0) {
      // Handle folder deletion - delete all files within the folder
      this.setFilesystem((fs: FileSystem) => {
        const newFs = { ...fs };
        for (const file of affectedFiles) {
          delete newFs[file.path];
        }
        return newFs;
      });
      
      this.version++; // Increment version after filesystem change
      // Call the emit for each deleted file
      for (const file of affectedFiles) {
        this.emit('fileDeleted', file.path);
      }
      
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
      
      this.version++; // Increment version after filesystem change
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
      
      this.version++; // Increment version after filesystem change
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
    return this.getFilesystem()[path];
  }

  listFiles(): File[] {
    return Object.values(this.getFilesystem());
  }

  fileExists(path: string): boolean {
    return path in this.getFilesystem();
  }

  getFileCount(): number {
    return Object.keys(this.getFilesystem()).length;
  }

  async downloadAsZip(filename?: string): Promise<void> {
    return downloadFilesystemAsZip(this.getFilesystem(), filename);
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

    // Create download link and trigger download
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(`Failed to create zip file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}