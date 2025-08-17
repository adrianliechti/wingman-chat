import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';

export interface ArtifactsContextType {
  isAvailable: boolean;
  fs: FileSystemManager | null;
  openFiles: string[];
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  filesystemVersion: number; // Track filesystem version for reactive updates
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
