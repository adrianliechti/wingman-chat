import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';

export interface ArtifactsContextType {
  isAvailable: boolean;
  fs: FileSystemManager;
  openFiles: string[];
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  setFileSystemForChat: (
    getFileSystem: (() => FileSystem) | null,
    setFileSystem: ((artifacts: FileSystem) => void) | null
  ) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
