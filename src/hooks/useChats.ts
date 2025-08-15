import { useState, useEffect } from 'react';

import type { Chat } from '../types/chat';
import { setValue, getValue } from '../lib/db';

const SAVE_DELAY = 2000;

const CHATS_KEY = 'chats';
const STORAGE_KEY = 'app_chats';

// Chat-specific database operations
async function storeChats(chats: Chat[]): Promise<void> {
  try {
    await setValue(CHATS_KEY, chats);
    //console.log('chats saved to IndexedDB');
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

// Migration function
async function migrateChats(): Promise<Chat[]> {
  try {
    // Check for legacy data in localStorage
    const data = localStorage.getItem(STORAGE_KEY);

    if (data) {
      const legacyChats = JSON.parse(data);

      if (Array.isArray(legacyChats) && legacyChats.length > 0) {
        console.log(`Migrating ${legacyChats.length} chats from localStorage to IndexedDB`);
        
        // Save legacy chats to IndexedDB (overwrite any existing data)
        await storeChats(legacyChats);
        
        // Clear legacy data from localStorage after successful migration
        localStorage.removeItem(STORAGE_KEY);
        
        console.log('Migration completed successfully');
        return legacyChats;
      }
    }

    // No legacy data, load from IndexedDB
    return await loadChats();
  } catch (error) {
    console.error('error during migration', error);
    // If migration fails, try to load from IndexedDB anyway
    return await loadChats();
  }
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);

  // Load chats on mount
  useEffect(() => {
    async function load() {
      const items = await migrateChats();
      setChats(items);
    }

    load();
  }, []);

  function createChat() {
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
  }

  function updateChat(chatId: string, updater: (chat: Chat) => Partial<Chat>): void {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          const updates = updater(chat);
          return { ...chat, ...updates, updated: new Date() };
        }
        return chat;
      })
    );
  }

  function deleteChat(chatId: string) {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
  }

  // Persist chats to storage with debounce when chats change
  useEffect(() => {
    const handler = window.setTimeout(() => {
      storeChats(chats);
    }, SAVE_DELAY);
    return () => {
      window.clearTimeout(handler);
    };
  }, [chats]);

  return { chats, createChat, updateChat, deleteChat };
}