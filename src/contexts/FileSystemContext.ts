import { createContext } from 'react';
import { FileSystemManager } from '../lib/fs';
import type { Chat } from '../types/chat';

export interface FileSystemContextType {
  currentFileSystem: FileSystemManager | null;
  setCurrentFileSystem: (fs: FileSystemManager | null) => void;
  setFileSystemForChat: (
    chatId: string, 
    chats: Chat[], 
    updateChat: (chatId: string, updater: (chat: Chat) => Partial<Chat>) => void
  ) => void;
}

export const FileSystemContext = createContext<FileSystemContextType | null>(null);
