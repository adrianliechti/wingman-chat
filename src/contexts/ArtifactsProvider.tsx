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
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const config = getConfig();
  const [isAvailable] = useState(() => {
    try {
      return !!config.artifacts;
    } catch (error) {
      console.warn('Failed to get artifacts config:', error);
      return false;
    }
  });
  const [isEnabled, setIsEnabled] = useState(false);
  const [version, setVersion] = useState(0);

  // Create singleton FileSystemManager instance
  const [fs] = useState(() => new FileSystemManager(
    () => ({}), // Default empty filesystem
    () => {} // Default setter - will be updated by setFileSystemForChat
  ));

  // Method to update the filesystem functions (called by ChatProvider)
  const setFileSystemForChat = useCallback((
    getFileSystem: (() => FileSystem) | null,
    setFileSystem: ((updater: (current: FileSystem) => FileSystem) => void) | null
  ) => {
    if (!getFileSystem || !setFileSystem) {
      // Reset to empty filesystem when no chat or artifacts disabled
      fs.updateHandlers(null, null);
      // Reset UI state
      setActiveFile(null);
      return;
    }

    // setFileSystem already uses updater pattern, just pass it through
    const wrappedSetter = setFileSystem;
    
    fs.updateHandlers(getFileSystem, wrappedSetter);
    
    // Reset UI state when switching to a new chat
    const currentFileSystem = getFileSystem();
    const currentFilePaths = Object.keys(currentFileSystem);
    
    // Clear active file if it doesn't exist in the new filesystem
    setActiveFile(currentActive => 
      currentActive && currentFilePaths.includes(currentActive) ? currentActive : null
    );
    
    // Auto-enable artifacts if the chat has files
    if (currentFilePaths.length > 0) {
      setIsEnabled(true);
    }

    setVersion(v => v + 1);
  }, [fs]);

  // Subscribe to filesystem events - use empty dependency array to prevent re-subscriptions
  useEffect(() => {
    const unsubscribeCreated = fs.subscribe('fileCreated', (path: string) => {
      setActiveFile(path);
      setShowArtifactsDrawer(true);
      // Auto-enable artifacts when a file is created
      setIsEnabled(true);
      setVersion(v => v + 1);
    });

    const unsubscribeDeleted = fs.subscribe('fileDeleted', (path: string) => {
      // Clear active file if it was the deleted one
      setActiveFile(currentActive => currentActive === path ? null : currentActive);
      setVersion(v => v + 1);
    });

    const unsubscribeRenamed = fs.subscribe('fileRenamed', (oldPath: string, newPath: string) => {
      setActiveFile(prev => prev === oldPath ? newPath : prev);
      setVersion(v => v + 1);
    });

    const unsubscribeUpdated = fs.subscribe('fileUpdated', () => {
      setVersion(v => v + 1);
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
    setActiveFile(path);
  }, []);

  const closeFile = useCallback((path: string) => {
    // If closing the active file, clear it
    if (path === activeFile) {
      setActiveFile(null);
    }
  }, [activeFile]);

  const toggleArtifactsDrawer = useCallback(() => {
    setShowArtifactsDrawer(prev => !prev);
  }, []);

  const toggleFileBrowser = useCallback(() => {
    setShowFileBrowser(prev => !prev);
  }, []);

  const value = {
    isAvailable,
    isEnabled,
    setEnabled: (enabled: boolean) => {
      // Prevent disabling if files exist
      if (!enabled && fs.listFiles().length > 0) {
        return;
      }
      setIsEnabled(enabled);
    },
    fs,
    activeFile,
    showArtifactsDrawer,
    showFileBrowser,
    version,
    openFile,
    closeFile,
    setShowArtifactsDrawer,
    toggleArtifactsDrawer,
    toggleFileBrowser,
    setFileSystemForChat,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
