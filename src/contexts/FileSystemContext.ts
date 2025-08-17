import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';

export interface FileSystemContextType {
  currentFileSystem: FileSystemManager | null;
  setCurrentFileSystem: (fs: FileSystemManager | null) => void;
  setFileSystemForChat: (
    getFileSystem: () => FileSystem, 
    setFileSystem: (artifacts: FileSystem) => void
  ) => void;
}

export const FileSystemContext = createContext<FileSystemContextType | null>(null);
