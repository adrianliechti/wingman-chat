import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';

export interface ArtifactsContextType {
  isAvailable: boolean;
  fs: FileSystemManager | null;
  openFiles: string[];
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  // Method to set the FileSystemManager from ChatPage
  setFileSystemManager: (manager: FileSystemManager | null) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
