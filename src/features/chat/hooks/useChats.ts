import { useCallback } from "react";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import type { Chat } from "@/shared/types/chat";
import { loadChats, removeChat, storeChat } from "../lib/chatStorage";

const storage = { load: loadChats, store: storeChat, remove: removeChat };

export function useChats() {
  const { items: chats, isLoaded, create, update, remove } = usePersistentCollection(storage);
  const createChat = useCallback(
    () =>
      create({
        id: crypto.randomUUID(),
        created: new Date(),
        updated: new Date(),
        model: null,
        messages: [],
      }),
    [create],
  );

  const updateChat = useCallback(
    (id: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }) => {
      update(id, (chat) => ({ ...chat, ...updater(chat), ...(options?.preserveDates ? {} : { updated: new Date() }) }));
    },
    [update],
  );

  const deleteChat = useCallback(
    (id: string) => {
      void remove(id).catch(() => {});
    },
    [remove],
  );
  return { chats, isLoaded, createChat, updateChat, deleteChat };
}
