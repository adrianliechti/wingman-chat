import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getConfig } from "@/shared/config";
import * as storeSession from "@/shared/lib/storeSession";
import { reportPersistenceError, usePersistenceQueue } from "@/shared/hooks/usePersistenceQueue";
import { notify } from "@/shared/lib/notify";
import { ChatStore } from "../lib/chatStore";
import { syncedChatStorage } from "../lib/syncedChatStorage";

/** `selectedId` subscribes to that conversation's record, not just the index. */
export function useChats(selectedId: string | null = null) {
  const queue = usePersistenceQueue();
  const [store] = useState(() => new ChatStore(queue, getConfig().store ? syncedChatStorage : undefined));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const getSelected = () => (selectedId ? (store.getChat(selectedId) ?? null) : null);
  const selectedChat = useSyncExternalStore(store.subscribe, getSelected, getSelected);
  useEffect(() => {
    void store.initialize().catch((error) => notify.error("Couldn't load saved chats", error));
  }, [store]);
  useEffect(() => {
    if (!getConfig().store) return;
    let cancelled = false;
    let unsubscribeRemote: (() => void) | undefined;
    const unsubscribe = storeSession.subscribeSession((session) => {
      unsubscribeRemote?.();
      unsubscribeRemote = undefined;
      if (session.status !== "ready") return;
      unsubscribeRemote = session.sync.subscribeRemoteChanges(store.applyRemoteChats);
      void (async () => {
        await store.initialize();
        const chats = await session.sync.pull();
        if (!cancelled) store.applyRemoteChats(chats);
      })().catch((error) => notify.error("Couldn't sync saved chats", error));
    });
    void storeSession.initSession();
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeRemote?.();
    };
  }, [store]);
  const createChat = useCallback(
    async (id?: string) => {
      try {
        return await store.createChat(id);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [store],
  );
  const deleteChat = useCallback(
    (id: string) => {
      void store.deleteChat(id).catch(reportPersistenceError);
    },
    [store],
  );
  return {
    ...state,
    selectedChat,
    createChat,
    deleteChat,
    updateChat: store.updateChat,
    getChat: store.getChat,
    loadChat: store.loadChat,
    searchChats: store.searchChats,
  };
}
