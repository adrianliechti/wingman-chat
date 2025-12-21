import { useState, useEffect, useCallback } from 'react';

import type { Chat } from '../types/chat';
import { setValue, getValue } from '../lib/db';

const CHATS_KEY = 'chats';

// Chat-specific database operations
async function storeChats(chats: Chat[]): Promise<void> {
  try {
    await setValue(CHATS_KEY, chats);
  } catch (error) {
    console.error('error saving chats to IndexedDB', error);
    throw error;
  }
}

async function loadChats(): Promise<Chat[]> {
  try {
    const chats = await getValue<Chat[]>(CHATS_KEY);
    
    if (!chats || !Array.isArray(chats)) {
      return [];
    }
    
    return chats;
  } catch (error) {
    console.error('error loading chats from IndexedDB', error);
    return [];
  }
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load chats on mount
  useEffect(() => {
    async function load() {
      const items = await loadChats();
      setChats(items);
      setIsLoaded(true);
    }

    load();
  }, []);

  const createChat = useCallback(() => {
    const chat: Chat = {
      id: crypto.randomUUID(),
      created: new Date(),
      updated: new Date(),
      model: null,
      messages: [],
      artifacts: {},
    };

    setChats((prev) => [chat, ...prev]);
    
    return chat;
  }, []);

  const updateChat = useCallback((chatId: string, updater: (chat: Chat) => Partial<Chat>): void => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          const updates = updater(chat);
          return { ...chat, ...updates, updated: new Date() };
        }
        return chat;
      })
    );
  }, []);

  const deleteChat = useCallback((chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
  }, []);

  // Persist chats to storage when chats change (skip initial empty state)
  useEffect(() => {
    if (!isLoaded) return;
    storeChats(chats);
  }, [chats, isLoaded]);

  return { chats, createChat, updateChat, deleteChat };
}