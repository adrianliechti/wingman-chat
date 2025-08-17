import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ArtifactsContext } from './ArtifactsContext';
import { getConfig } from '../config';
import { useFileSystem } from '../hooks/useFileSystem';

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  // Get the current filesystem from the FileSystemProvider
  const { currentFileSystem: fs } = useFileSystem();

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

  // Subscribe to filesystem events for reactive updates
  useEffect(() => {
    if (!fs) {
      return;
    }

    const unsubscribeCreated = fs.subscribe('fileCreated', (path: string) => {
      // Auto-open newly created files
      setOpenFiles(prev => {
        if (prev.includes(path)) {
          return prev;
        }
        const newOpenFiles = [...prev, path];
        return newOpenFiles;
      });
      setActiveFile(path);
    });

    const unsubscribeDeleted = fs.subscribe('fileDeleted', (path: string) => {
      // Remove deleted files from open tabs
      setOpenFiles(prev => {
        const newFiles = prev.filter(file => file !== path);
        
        // If the deleted file was active, set a new active file
        setActiveFile(currentActiveFile => {
          if (path === currentActiveFile) {
            const index = prev.indexOf(path);
            return newFiles.length > 0 
              ? newFiles[Math.min(index, newFiles.length - 1)]
              : null;
          }
          return currentActiveFile;
        });
        
        return newFiles;
      });
    });

    const unsubscribeRenamed = fs.subscribe('fileRenamed', (oldPath: string, newPath: string) => {
      // Update open files with new path
      setOpenFiles(prev => prev.map(file => file === oldPath ? newPath : file));
      // Update active file if it was renamed
      setActiveFile(prev => prev === oldPath ? newPath : prev);
    });

    const unsubscribeUpdated = fs.subscribe('fileUpdated', () => {
      // File content updated - no need to change tabs
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs]);

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
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
