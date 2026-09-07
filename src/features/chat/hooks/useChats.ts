import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { reportPersistenceError, usePersistenceQueue } from "@/shared/hooks/usePersistenceQueue";
import { notify } from "@/shared/lib/notify";
import { ChatStore } from "../lib/chatStore";

export function useChats() {
  const queue = usePersistenceQueue();
  const [store] = useState(() => new ChatStore(queue));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.initialize().catch((error) => notify.error("Couldn't load saved chats", error));
  }, [store]);
  const createChat = useCallback(async () => {
    try {
      return await store.createChat();
    } catch (error) {
      reportPersistenceError(error);
      throw error;
    }
  }, [store]);
  const deleteChat = useCallback(
    (id: string) => {
      void store.deleteChat(id).catch(reportPersistenceError);
    },
    [store],
  );
  return {
    ...state,
    createChat,
    deleteChat,
    updateChat: store.updateChat,
    getChat: store.getChat,
    loadChat: store.loadChat,
    searchChats: store.searchChats,
  };
}
