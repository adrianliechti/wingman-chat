import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "@/shared/config";
import * as chatSession from "@/shared/lib/chatSession";
import type { StoredChat } from "@/shared/lib/opfs";
import * as opfs from "@/shared/lib/opfs";
import type { Chat } from "@/shared/types/chat";

const COLLECTION = "chats";

// OPFS-only path (used when the server chatstore is not enabled in config).
// Each chat is stored as: /chats/{id}/chat.json with blobs in /chats/{id}/blobs/

async function storeChatLocal(chat: Chat): Promise<void> {
  const stored = await opfs.extractChatBlobs(chat);
  await opfs.writeJson(`${COLLECTION}/${chat.id}/chat.json`, stored);
  await opfs.upsertIndexEntry(COLLECTION, {
    id: chat.id,
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    updated: stored.updated || new Date().toISOString(),
  });
}

async function loadChatLocal(id: string): Promise<Chat | undefined> {
  let stored = await opfs.readJson<StoredChat>(`${COLLECTION}/${id}/chat.json`);
  if (!stored) {
    stored = await opfs.readJson<StoredChat>(`${COLLECTION}/${id}.json`);
    if (stored) console.log(`Migrating chat ${id} to folder structure`);
  }
  if (!stored) return undefined;
  return opfs.rehydrateChatBlobs(stored);
}

async function removeChatLocal(id: string): Promise<void> {
  await opfs.deleteDirectory(`${COLLECTION}/${id}`);
  await opfs.deleteFile(`${COLLECTION}/${id}.json`);
  await opfs.removeIndexEntry(COLLECTION, id);
}

async function loadChatIndex(): Promise<opfs.IndexEntry[]> {
  return opfs.readIndex(COLLECTION);
}

async function loadAllLocal(): Promise<Chat[]> {
  const index = await loadChatIndex();
  const config = getConfig();
  const retentionDays = config.chat?.retentionDays;
  if (retentionDays && retentionDays > 0) {
    const expired = getExpiredChatIds(index, retentionDays);
    if (expired.length > 0) {
      console.log(`Chat retention: deleting ${expired.length} chat(s) older than ${retentionDays} days`);
      for (const id of expired) await removeChatLocal(id);
    }
  }
  const updatedIndex = await loadChatIndex();
  const loaded: Chat[] = [];
  for (const entry of updatedIndex) {
    const chat = await loadChatLocal(entry.id);
    if (chat) loaded.push(chat);
  }
  return loaded;
}

function getExpiredChatIds(entries: opfs.IndexEntry[], retentionDays: number): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.updated) continue;
    if (new Date(entry.updated) < cutoff) out.push(entry.id);
  }
  return out;
}

// Server-synced path -----------------------------------------------------

async function storeChatRemote(chat: Chat): Promise<void> {
  const session = await chatSession.whenReady();
  await session.sync.saveChat(chat);
}

async function removeChatRemote(id: string): Promise<void> {
  const session = await chatSession.whenReady();
  await session.sync.deleteChat(id);
}

async function loadAllRemote(): Promise<Chat[]> {
  const session = await chatSession.whenReady();
  return session.sync.pull();
}

// Dispatch ---------------------------------------------------------------

function isServerMode(): boolean {
  return chatSession.isEnabled();
}

async function storeChat(chat: Chat): Promise<void> {
  return isServerMode() ? storeChatRemote(chat) : storeChatLocal(chat);
}

async function removeChat(id: string): Promise<void> {
  return isServerMode() ? removeChatRemote(id) : removeChatLocal(id);
}

async function loadAll(): Promise<Chat[]> {
  return isServerMode() ? loadAllRemote() : loadAllLocal();
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

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
    let cancelled = false;

    async function load() {
      try {
        const loadedChats = await loadAll();
        loadedChats.sort((a, b) => {
          const aTime = a.updated?.getTime() || 0;
          const bTime = b.updated?.getTime() || 0;
          return bTime - aTime;
        });
        if (!cancelled) setChats(loadedChats);
      } catch (error) {
        console.error("Error loading chats:", error);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    }

    // Kick off session bootstrapping in parallel; load() awaits readiness
    // internally via whenReady() if we're in server mode.
    void chatSession.initSession();
    load();

    // Re-load when the session transitions to "ready" after a PIN unlock.
    const unsub = chatSession.subscribeSession((s) => {
      if (s.status === "ready") load();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Debounced save function
  const scheduleSave = useCallback((chatId: string) => {
    pendingSaves.current.add(chatId);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const idsToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();

      for (const id of idsToSave) {
        const chat = chatsRef.current.find((c) => c.id === id);
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

  const createChat = useCallback(async () => {
    const chat: Chat = {
      id: crypto.randomUUID(),
      created: new Date(),
      updated: new Date(),
      model: null,
      messages: [],
    };

    setChats((prev) => [chat, ...prev]);

    try {
      await storeChat(chat);
    } catch (error) {
      console.error("Error saving new chat:", error);
    }

    return chat;
  }, []);

  const updateChat = useCallback(
    (chatId: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }): void => {
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

        const updatedChat = updated.find((c) => c.id === chatId);
        if (updatedChat) {
          setTimeout(() => scheduleSave(chatId), 0);
        }

        return updated;
      });
    },
    [scheduleSave],
  );

  const deleteChat = useCallback((chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));

    removeChat(chatId).catch((error) => {
      console.error(`Error deleting chat ${chatId}:`, error);
    });
  }, []);

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    const pending = pendingSaves;
    const chatsReference = chatsRef;
    const timeout = saveTimeoutRef;

    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }

      const idsToSave = Array.from(pending.current);
      pending.current.clear();

      for (const id of idsToSave) {
        const chat = chatsReference.current.find((c) => c.id === id);
        if (chat) {
          storeChat(chat).catch(console.warn);
        }
      }
    };
  }, []);

  return { chats, isLoaded, createChat, updateChat, deleteChat };
}
