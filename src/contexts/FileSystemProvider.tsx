import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { FileSystemContext } from './FileSystemContext';
import { FileSystemManager } from '../lib/fs';
import type { FileSystem } from '../types/file';
import type { Chat } from '../types/chat';

interface FileSystemProviderProps {
  children: ReactNode;
}

export function FileSystemProvider({ children }: FileSystemProviderProps) {
  const [currentFileSystem, setCurrentFileSystem] = useState<FileSystemManager | null>(null);

  const setFileSystemForChat = useCallback((
    chatId: string, 
    chats: Chat[], 
    updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>) => void
  ) => {
    if (!chatId) {
      setCurrentFileSystem(null);
      return;
    }

    console.log('🔧 Creating FileSystemManager for chat:', chatId);
    
    // Create a FileSystemManager that directly uses the chat store
    const fs = new FileSystemManager(
      // Get filesystem from current chat
      () => {
        // Find the current chat from the chats array to get latest state
        const currentChat = chats.find(c => c.id === chatId);
        return currentChat?.artifacts || {};
      },
      
      // Update filesystem in chat
      (updater: (current: FileSystem) => FileSystem) => {
        updateChat(chatId, (currentChat: Chat) => ({
          artifacts: updater(currentChat.artifacts || {})
        }));
      }
    );

    setCurrentFileSystem(fs);
  }, []);

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
