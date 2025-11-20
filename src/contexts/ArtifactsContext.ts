import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';

export interface ArtifactsContextType {
  isAvailable: boolean;
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  fs: FileSystemManager;
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  showFileBrowser: boolean;
  version: number;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  toggleFileBrowser: () => void;
  setFileSystemForChat: (
    getFileSystem: (() => FileSystem) | null,
    setFileSystem: ((updater: (current: FileSystem) => FileSystem) => void) | null
  ) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
