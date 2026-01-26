import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';

export interface ArtifactsContextType {
  isAvailable: boolean;
  isEnabled: boolean;
  fs: FileSystemManager;
  activeFile: string | null;
  showArtifactsDrawer: boolean;
  openFile: (path: string) => void;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
  setChatId: (chatId: string | null) => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
