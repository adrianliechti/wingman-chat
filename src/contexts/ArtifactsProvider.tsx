import { useState, useCallback, ReactNode, useEffect } from 'react';
import { ArtifactsContext } from './ArtifactsContext';
import { FileSystemManager } from '../lib/fs';
import { getConfig } from '../config';

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [fs, setFs] = useState<FileSystemManager | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  // Check artifacts availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.artifacts.enabled);
    } catch (error) {
      console.warn('Failed to get artifacts config:', error);
      setIsAvailable(false);
    }
  }, []);

  // Method to set the FileSystemManager from ChatPage
  const setFileSystemManager = useCallback((manager: FileSystemManager | null) => {
    setFs(manager);
    // Reset files when filesystem manager changes
    setOpenFiles([]);
    setActiveFile(null);
  }, []);

  const openFile = useCallback((path: string) => {
    setOpenFiles(prev => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
    setActiveFile(path);
  }, []);

  const closeFile = useCallback((path: string) => {
    setOpenFiles(prev => {
      const newFiles = prev.filter(file => file !== path);
      
      // If closing the active file, set a new active file
      if (path === activeFile) {
        const index = prev.indexOf(path);
        const newActiveFile = newFiles.length > 0 
          ? newFiles[Math.min(index, newFiles.length - 1)]
          : null;
        setActiveFile(newActiveFile);
      }
      
      return newFiles;
    });
  }, [activeFile]);

  const toggleArtifactsDrawer = useCallback(() => {
    setShowArtifactsDrawer(prev => !prev);
  }, []);

  const value = {
    isAvailable,
    fs,
    openFiles,
    activeFile,
    showArtifactsDrawer,
    openFile,
    closeFile,
    setShowArtifactsDrawer,
    toggleArtifactsDrawer,
    setFileSystemManager,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
