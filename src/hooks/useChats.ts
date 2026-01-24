import { useState, useEffect, useCallback } from 'react';

import type { Chat, Message, Content } from '../types/chat';
import { setValue, getValue } from '../lib/db';
import { getConfig } from '../config';

const CHATS_KEY = 'chats';

// ============================================================================
// MIGRATION CODE - REMOVE AFTER MARCH 2026
// This code migrates old message formats stored in IndexedDB to the new format.
// After March 2026, all users should have their data migrated and this code
// can be safely removed along with the toDataUrl and migrateMessage functions.
// ============================================================================

/**
 * @deprecated REMOVE AFTER MARCH 2026
 * Helper to create data URL from old mimeType + base64 data format
 */
function toDataUrl(mimeType: string, data: string): string {
  // If data is already a data URL, return as-is
  if (data.startsWith('data:')) {
    return data;
  }
  return `data:${mimeType};base64,${data}`;
}

/**
 * @deprecated REMOVE AFTER MARCH 2026
 * Migrate old message format to new format.
 * Handles: separate mimeType+data fields, attachments array, toolCalls/toolResult,
 * reasoning field, role:'tool', and string content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateMessage(msg: any): Message {
  // Check if already in new format (content is array with no attachments and no separate mimeType fields)
  if (Array.isArray(msg.content) && !msg.attachments?.length) {
    // Migrate existing content parts to use data URLs (handle old mimeType+data format)
    const migratedContent: Content[] = msg.content.map((part: any) => {
      if (part.type === 'image' && part.mimeType) {
        // Old format: { type: 'image', mimeType, data } -> new format: { type: 'image', data (dataURL) }
        return { type: 'image', name: part.name, data: toDataUrl(part.mimeType, part.data) };
      } else if (part.type === 'audio' && part.mimeType) {
        return { type: 'audio', name: part.name, data: toDataUrl(part.mimeType, part.data) };
      } else if (part.type === 'file' && part.mimeType) {
        return { type: 'file', name: part.name, data: toDataUrl(part.mimeType, part.data) };
      } else if (part.type === 'tool_result' && part.result) {
        // Migrate tool result contents too
        const migratedResult = part.result.map((r: any) => {
          if (r.type === 'image' && r.mimeType) {
            return { type: 'image', name: r.name, data: toDataUrl(r.mimeType, r.data) };
          } else if (r.type === 'audio' && r.mimeType) {
            return { type: 'audio', name: r.name, data: toDataUrl(r.mimeType, r.data) };
          } else if (r.type === 'file' && r.mimeType) {
            return { type: 'file', name: r.name, data: toDataUrl(r.mimeType, r.data) };
          }
          return r;
        });
        return { ...part, result: migratedResult };
      }
      return part;
    });
    
    // Convert role: 'tool' to 'user'
    const role = msg.role === 'tool' ? 'user' : msg.role;
    return { ...msg, role, content: migratedContent } as Message;
  }

  const content: Content[] = [];
  
  // Migrate reasoning
  if (msg.reasoning) {
    content.push({ type: 'reasoning', text: msg.reasoning });
  }
  
  // Migrate text content
  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    // Already array, copy existing content (with migration)
    for (const part of msg.content) {
      if (part.type === 'image' && part.mimeType) {
        content.push({ type: 'image', name: part.name, data: toDataUrl(part.mimeType, part.data) });
      } else if (part.type === 'audio' && part.mimeType) {
        content.push({ type: 'audio', name: part.name, data: toDataUrl(part.mimeType, part.data) });
      } else if (part.type === 'file' && part.mimeType) {
        content.push({ type: 'file', name: part.name, data: toDataUrl(part.mimeType, part.data) });
      } else {
        content.push(part);
      }
    }
  }
  
  // Migrate attachments to content
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === 'image_data' || att.type === 'image') {
        // att.data is already a data URL
        content.push({ type: 'image', name: att.name, data: att.data });
      } else if (att.type === 'file_data' || att.type === 'file') {
        content.push({ type: 'file', name: att.name, data: att.data });
      } else if (att.type === 'text') {
        content.push({ type: 'text', text: `// ${att.name}\n${att.data}` });
      }
    }
  }
  
  // Migrate tool calls
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      content.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
    }
  }
  
  // Migrate tool result
  if (msg.toolResult) {
    const resultData = msg.toolResult.data;
    let result: (typeof content[number])[];
    if (typeof resultData === 'string') {
      result = [{ type: 'text' as const, text: resultData }];
    } else if (Array.isArray(resultData)) {
      // Migrate nested content items (convert mimeType+data to dataURL format)
      result = resultData.map((r: any) => {
        if (r.type === 'image' && r.mimeType) {
          return { type: 'image', name: r.name, data: toDataUrl(r.mimeType, r.data) };
        } else if (r.type === 'audio' && r.mimeType) {
          return { type: 'audio', name: r.name, data: toDataUrl(r.mimeType, r.data) };
        }
        return r;
      });
    } else {
      result = [];
    }
    content.push({
      type: 'tool_result',
      id: msg.toolResult.id,
      name: msg.toolResult.name,
      arguments: msg.toolResult.arguments,
      result: result as any,
    });
  }

  // Convert role: 'tool' to 'user'
  const role = msg.role === 'tool' ? 'user' : msg.role;

  return { role, content, error: msg.error };
}

// ============================================================================
// END MIGRATION CODE - REMOVE AFTER MARCH 2026
// ============================================================================

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
    
    // Migrate old format messages on load
    // @deprecated REMOVE AFTER MARCH 2026 - change to just: return chats;
    return chats.map(chat => ({
      ...chat,
      messages: chat.messages.map(migrateMessage),
    }));
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