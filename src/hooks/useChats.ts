import { useState, useEffect, useCallback } from 'react';

import type { Chat } from '../types/chat';
import { setValue, getValue } from '../lib/db';
import { getConfig } from '../config';

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

// Apply retention policy to chats, removing those older than retentionDays based on updated timestamp
function applyRetentionPolicy(chats: Chat[], retentionDays: number): Chat[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const filtered = chats.filter((chat) => {
    // Keep chats without an updated timestamp (safe default)
    if (!chat.updated) {
      return true;
    }

    const updatedDate = new Date(chat.updated);
    return updatedDate >= cutoff;
  });

  const deletedCount = chats.length - filtered.length;
  if (deletedCount > 0) {
    console.log(`chat retention: deleted ${deletedCount} chat(s) older than ${retentionDays} days`);
  }

  return filtered;
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load chats on mount
  useEffect(() => {
    async function load() {
      let items = await loadChats();

      // Apply retention policy if configured
      const config = getConfig();
      const retentionDays = config.chat?.retentionDays;

      if (retentionDays && retentionDays > 0) {
        const filteredItems = applyRetentionPolicy(items, retentionDays);

        // Persist filtered chats if any were removed
        if (filteredItems.length < items.length) {
          await storeChats(filteredItems);
        }

        items = filteredItems;
      }

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