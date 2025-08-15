import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
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
  const [filesystemVersion, setFilesystemVersion] = useState(0); // Track filesystem version for reactive updates

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

  // Subscribe to filesystem events for reactive updates
  useEffect(() => {
    if (!fs) return;

    // Sync initial filesystem version
    setFilesystemVersion(fs.filesystemVersion);

    const unsubscribeCreated = fs.subscribe('fileCreated', (path: string) => {
      // Auto-open newly created files
      setOpenFiles(prev => {
        if (prev.includes(path)) return prev;
        return [...prev, path];
      });
      setActiveFile(path);
      setFilesystemVersion(fs.filesystemVersion); // Sync version for reactive updates
    });

    const unsubscribeDeleted = fs.subscribe('fileDeleted', (path: string) => {
      // Remove deleted files from open tabs
      setOpenFiles(prev => {
        const newFiles = prev.filter(file => file !== path);
        
        // If the deleted file was active, set a new active file
        if (path === activeFile) {
          const index = prev.indexOf(path);
          const newActiveFile = newFiles.length > 0 
            ? newFiles[Math.min(index, newFiles.length - 1)]
            : null;
          setActiveFile(newActiveFile);
        }
        
        return newFiles;
      });
      setFilesystemVersion(fs.filesystemVersion); // Sync version for reactive updates
    });

    const unsubscribeRenamed = fs.subscribe('fileRenamed', (oldPath: string, newPath: string) => {
      // Update open files with new path
      setOpenFiles(prev => prev.map(file => file === oldPath ? newPath : file));
      // Update active file if it was renamed
      setActiveFile(prev => prev === oldPath ? newPath : prev);
      setFilesystemVersion(fs.filesystemVersion); // Sync version for reactive updates
    });

    const unsubscribeUpdated = fs.subscribe('fileUpdated', () => {
      // File content updated - no need to change tabs, just sync version for reactive updates
      setFilesystemVersion(fs.filesystemVersion);
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs, activeFile]);

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
    filesystemVersion, // Include version to force re-renders
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
