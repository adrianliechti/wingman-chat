import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ArtifactsContext } from './ArtifactsContext';
import { getConfig } from '../config';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  // Create singleton FileSystemManager instance
  const [fs] = useState(() => new FileSystemManager(
    () => ({}), // Default empty filesystem
    () => {} // Default setter - will be updated by setFileSystemForChat
  ));

  // Method to update the filesystem functions (called by ChatProvider)
  const setFileSystemForChat = useCallback((
    getFileSystem: (() => FileSystem) | null,
    setFileSystem: ((artifacts: FileSystem) => void) | null
  ) => {
    if (!getFileSystem || !setFileSystem) {
      // Reset to empty filesystem when no chat or artifacts disabled
      fs.updateHandlers(null, null);
      // Reset UI state
      setOpenFiles([]);
      setActiveFile(null);
      return;
    }

    // Wrap the setFileSystem to match the expected signature
    const wrappedSetter = (updateFn: (current: FileSystem) => FileSystem) => {
      const currentFs = getFileSystem();
      const newFs = updateFn(currentFs);
      setFileSystem(newFs);
    };
    
    fs.updateHandlers(getFileSystem, wrappedSetter);
    
    // Reset UI state when switching to a new chat
    const currentFileSystem = getFileSystem();
    const currentFilePaths = Object.keys(currentFileSystem);
    
    // Only keep open files that exist in the new filesystem
    setOpenFiles(prev => prev.filter(path => currentFilePaths.includes(path)));
    
    // Clear active file if it doesn't exist in the new filesystem
    setActiveFile(currentActive => 
      currentActive && currentFilePaths.includes(currentActive) ? currentActive : null
    );
  }, [fs]);

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

  // Subscribe to filesystem events - use empty dependency array to prevent re-subscriptions
  useEffect(() => {
    const unsubscribeCreated = fs.subscribe('fileCreated', (path: string) => {
      // Batch state updates together
      setOpenFiles(prev => {
        if (prev.includes(path)) {
          return prev;
        }
        const newFiles = [...prev, path];
        return newFiles;
      });
      
      setActiveFile(path);
      setShowArtifactsDrawer(true);
    });

    const unsubscribeDeleted = fs.subscribe('fileDeleted', (path: string) => {
      setOpenFiles(prev => prev.filter(file => file !== path));
      
      // Clear active file if it was the deleted one
      setActiveFile(currentActive => currentActive === path ? null : currentActive);
    });

    const unsubscribeRenamed = fs.subscribe('fileRenamed', (oldPath: string, newPath: string) => {
      setOpenFiles(prev => prev.map(file => file === oldPath ? newPath : file));
      setActiveFile(prev => prev === oldPath ? newPath : prev);
    });

    const unsubscribeUpdated = fs.subscribe('fileUpdated', () => {
      // No state changes needed for content updates
    });

    // Cleanup function
    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs]); // fs is stable from useState, so this effectively runs once

  const openFile = useCallback((path: string) => {
    setOpenFiles(prev => {
      if (prev.includes(path)) {
        return prev;
      }
      const newFiles = [...prev, path];
      return newFiles;
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
    setFileSystemForChat,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
