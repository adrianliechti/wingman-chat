import { useState, useEffect, useCallback, useRef } from 'react';

import type { Chat } from '../types/chat';
import * as opfs from '../lib/opfs';
import type { StoredChat } from '../lib/opfs';
import { getConfig } from '../config';

const COLLECTION = 'chats';

// Chat-specific OPFS operations using new folder structure
// Each chat is stored as: /chats/{id}/chat.json with blobs in /chats/{id}/blobs/

async function storeChat(chat: Chat): Promise<void> {
  try {
    // Extract blobs and store in chat's folder (blobs go to /chats/{id}/blobs/)
    const stored = await opfs.extractChatBlobs(chat);
    
    // Write chat.json to /chats/{id}/chat.json
    await opfs.writeJson(`${COLLECTION}/${chat.id}/chat.json`, stored);
    
    // Update index
    await opfs.upsertIndexEntry(COLLECTION, {
      id: chat.id,
      title: chat.title,
      updated: stored.updated || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error saving chat to OPFS:', error);
    throw error;
  }
}

async function loadChat(id: string): Promise<Chat | undefined> {
  try {
    // Try new folder structure first: /chats/{id}/chat.json
    let stored = await opfs.readJson<StoredChat>(`${COLLECTION}/${id}/chat.json`);
    
    // Fall back to legacy file: /chats/{id}.json
    if (!stored) {
      stored = await opfs.readJson<StoredChat>(`${COLLECTION}/${id}.json`);
      if (stored) {
        // Migrate to new structure on next save
        console.log(`Migrating chat ${id} to folder structure`);
      }
    }
    
    if (!stored) {
      return undefined;
    }
    
    // Rehydrate blobs (handles both chat-scoped and legacy central blobs)
    const chat = await opfs.rehydrateChatBlobs(stored);
    
    return chat;
  } catch (error) {
    console.error(`Error loading chat ${id} from OPFS:`, error);
    return undefined;
  }
}

async function removeChat(id: string): Promise<void> {
  try {
    // With folder structure, just delete the entire folder
    // This removes chat.json, all blobs, and all artifacts in one operation
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);
    
    // Also try to delete legacy file if it exists
    await opfs.deleteFile(`${COLLECTION}/${id}.json`);
    
    // Update index
    await opfs.removeIndexEntry(COLLECTION, id);
  } catch (error) {
    console.error(`Error deleting chat ${id} from OPFS:`, error);
    throw error;
  }
}

async function loadChatIndex(): Promise<opfs.IndexEntry[]> {
  try {
    return await opfs.readIndex(COLLECTION);
  } catch (error) {
    console.error('Error loading chat index from OPFS:', error);
    return [];
  }
}

// Apply retention policy to index entries, returning IDs to delete
function getExpiredChatIds(entries: opfs.IndexEntry[], retentionDays: number): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  
  const expiredIds: string[] = [];
  
  for (const entry of entries) {
    if (!entry.updated) continue;
    
    const updatedDate = new Date(entry.updated);
    if (updatedDate < cutoff) {
      expiredIds.push(entry.id);
    }
  }
  
  return expiredIds;
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  
  // Track which chats have been modified and need saving
  const pendingSaves = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Keep a ref to the current chats for use in async callbacks
  const chatsRef = useRef<Chat[]>(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Load all chats on mount (needed for sidebar display)
  useEffect(() => {
    async function load() {
      try {
        // Load index first
        const index = await loadChatIndex();
        
        // Apply retention policy if configured
        const config = getConfig();
        const retentionDays = config.chat?.retentionDays;
        
        if (retentionDays && retentionDays > 0) {
          const expiredIds = getExpiredChatIds(index, retentionDays);
          
          if (expiredIds.length > 0) {
            console.log(`Chat retention: deleting ${expiredIds.length} chat(s) older than ${retentionDays} days`);
            
            // Delete expired chats
            for (const id of expiredIds) {
              await removeChat(id);
            }
          }
        }
        
        // Load remaining chats from updated index
        const updatedIndex = await loadChatIndex();
        const loadedChats: Chat[] = [];
        
        for (const entry of updatedIndex) {
          const chat = await loadChat(entry.id);
          if (chat) {
            loadedChats.push(chat);
          }
        }
        
        // Sort by updated date (newest first)
        loadedChats.sort((a, b) => {
          const aTime = a.updated?.getTime() || 0;
          const bTime = b.updated?.getTime() || 0;
          return bTime - aTime;
        });
        
        setChats(loadedChats);
      } catch (error) {
        console.error('Error loading chats:', error);
      }
    }

    load();
  }, []);

  // Debounced save function
  const scheduleSave = useCallback((chatId: string) => {
    pendingSaves.current.add(chatId);
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Schedule save after short delay (debounce rapid updates)
    saveTimeoutRef.current = setTimeout(async () => {
      const idsToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();
      
      for (const id of idsToSave) {
        // Use chatsRef.current to get the latest chats state
        const chat = chatsRef.current.find(c => c.id === id);
        if (chat) {
          try {
            await storeChat(chat);
          } catch (error) {
            console.error(`Error saving chat ${id}:`, error);
          }
        }
      }
    }, 100);
  }, []);

  const createChat = useCallback(() => {
    const chat: Chat = {
      id: crypto.randomUUID(),
      created: new Date(),
      updated: new Date(),
      model: null,
      messages: [],
    };

    setChats((prev) => [chat, ...prev]);
    
    // Save immediately for new chats
    storeChat(chat).catch(error => {
      console.error('Error saving new chat:', error);
    });
    
    return chat;
  }, []);

  const updateChat = useCallback((chatId: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }): void => {
    setChats((prev) => {
      const updated = prev.map((chat) => {
        if (chat.id === chatId) {
          const updates = updater(chat);
          if (options?.preserveDates) {
            return { ...chat, ...updates };
          }
          return { ...chat, ...updates, updated: new Date() };
        }
        return chat;
      });
      
      // Schedule save for this chat
      const updatedChat = updated.find(c => c.id === chatId);
      if (updatedChat) {
        // Use setTimeout to avoid calling during render
        setTimeout(() => scheduleSave(chatId), 0);
      }
      
      return updated;
    });
  }, [scheduleSave]);

  const deleteChat = useCallback((chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    
    // Remove from storage
    removeChat(chatId).catch(error => {
      console.error(`Error deleting chat ${chatId}:`, error);
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return { chats, createChat, updateChat, deleteChat };
}