import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ArtifactsContext } from './ArtifactsContext';
import { getConfig } from '../config';
import { FileSystemManager } from '../lib/fs';

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
  const [fs] = useState(() => new FileSystemManager());

  // Method to set the chat ID for the filesystem (called by ChatProvider)
  const setChatId = useCallback(async (chatId: string | null) => {
    fs.setChatId(chatId);
    
    if (!chatId) {
      // Reset UI state when no chat
      setActiveFile(null);
      return;
    }
    
    // Check if the chat has files and update UI state
    const fileCount = await fs.getFileCount();
    
    // Auto-enable artifacts if the chat has files
    if (fileCount > 0) {
      setIsEnabled(true);
      setShowArtifactsDrawer(true);
    }

    // Clear active file if it doesn't exist in the new chat
    if (activeFile) {
      const fileExists = await fs.fileExists(activeFile);
      if (!fileExists) {
        setActiveFile(null);
      }
    }

    setVersion(v => v + 1);
  }, [fs, activeFile]);

  // Subscribe to filesystem events
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
  }, [fs]);

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

  const setEnabled = useCallback(async (enabled: boolean) => {
    // Prevent disabling if files exist
    if (!enabled) {
      const fileCount = await fs.getFileCount();
      if (fileCount > 0) {
        return;
      }
    }
    setIsEnabled(enabled);
  }, [fs]);

  const value = {
    isAvailable,
    isEnabled,
    setEnabled,
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
    setChatId,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
