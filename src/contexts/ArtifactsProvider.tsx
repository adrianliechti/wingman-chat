import { useState, useCallback, ReactNode, useEffect } from 'react';
import { ArtifactsContext } from './ArtifactsContext';
import { File, FileSystem } from '../types/file';
import { downloadFilesystemAsZip } from '../lib/fs';
import { getConfig } from '../config';

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [filesystem, setFilesystem] = useState<FileSystem>({});
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
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

  const openTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
    setActiveTab(path);
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const newTabs = prev.filter(tab => tab !== path);
      
      // If closing the active tab, set a new active tab
      if (path === activeTab) {
        const index = prev.indexOf(path);
        const newActiveTab = newTabs.length > 0 
          ? newTabs[Math.min(index, newTabs.length - 1)]
          : null;
        setActiveTab(newActiveTab);
      }
      
      return newTabs;
    });
  }, [activeTab]);

  const createFile = useCallback((path: string, content: Blob) => {
    const now = new Date();
    const file: File = {
      path,
      content,
      createdAt: now,
      updatedAt: now,
    };

    setFilesystem(prev => ({
      ...prev,
      [path]: file
    }));

    // Auto-open the newly created file
    openTab(path);
  }, [openTab]);

  const updateFile = useCallback((path: string, content: Blob) => {
    setFilesystem(prev => {
      const existingFile = prev[path];
      if (!existingFile) return prev;

      return {
        ...prev,
        [path]: {
          ...existingFile,
          content,
          updatedAt: new Date(),
        }
      };
    });
  }, []);

  const deleteFile = useCallback((path: string) => {
    setFilesystem(prev => {
      const newFs = { ...prev };
      delete newFs[path];
      return newFs;
    });

    // Close tab if it's open
    closeTab(path);
  }, [closeTab]);

  const getFile = useCallback((path: string): File | undefined => {
    return filesystem[path];
  }, [filesystem]);

  const toggleArtifactsDrawer = useCallback(() => {
    setShowArtifactsDrawer(prev => !prev);
  }, []);

  const downloadAsZip = useCallback(async (filename?: string) => {
    try {
      await downloadFilesystemAsZip(filesystem, filename);
    } catch (error) {
      console.error('Failed to download filesystem as zip:', error);
      throw error;
    }
  }, [filesystem]);

  const value = {
    isAvailable,
    filesystem,
    openTabs,
    activeTab,
    showArtifactsDrawer,
    createFile,
    updateFile,
    deleteFile,
    openTab,
    closeTab,
    setActiveTab,
    getFile,
    setShowArtifactsDrawer,
    toggleArtifactsDrawer,
    downloadAsZip,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}
