import { createContext } from 'react';
import { File, FileSystem } from '../types/file';

export interface ArtifactsContextType {
  filesystem: FileSystem;
  openTabs: string[];
  activeTab: string | null;
  showArtifactsDrawer: boolean;
  createFile: (path: string, content: Blob) => void;
  updateFile: (path: string, content: Blob) => void;
  deleteFile: (path: string) => void;
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string | null) => void;
  getFile: (path: string) => File | undefined;
  setShowArtifactsDrawer: (show: boolean) => void;
  toggleArtifactsDrawer: () => void;
}

export const ArtifactsContext = createContext<ArtifactsContextType | null>(null);
