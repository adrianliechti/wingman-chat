import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { FileSystemContext } from './FileSystemContext';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';

interface FileSystemProviderProps {
  children: ReactNode;
}

export function FileSystemProvider({ children }: FileSystemProviderProps) {
  const [currentFileSystem, setCurrentFileSystemState] = useState<FileSystemManager | null>(null);

  const setCurrentFileSystem = useCallback((fs: FileSystemManager | null) => {
    setCurrentFileSystemState(fs);
  }, []);

  const setFileSystemForChat = useCallback((
    getFileSystem: () => FileSystem, 
    setFileSystem: (artifacts: FileSystem) => void
  ) => {
    // Create a FileSystemManager that directly uses the chat store
    const fs = new FileSystemManager(
      // Get filesystem from current chat
      () => {
        const artifacts = getFileSystem();
        return artifacts;
      },
      
      // Update filesystem in chat
      (updater: (current: FileSystem) => FileSystem) => {
        const currentArtifacts = getFileSystem();
        const updatedArtifacts = updater(currentArtifacts);
        setFileSystem(updatedArtifacts);
      }
    );

    setCurrentFileSystem(fs);
  }, [setCurrentFileSystem]);

  const value = {
    currentFileSystem,
    setCurrentFileSystem,
    setFileSystemForChat,
  };

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  );
}
