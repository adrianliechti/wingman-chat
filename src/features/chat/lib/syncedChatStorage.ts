import * as storeSession from "@/shared/lib/storeSession";
import type { Chat } from "@/shared/types/chat";
import { loadChat, loadChatIndex, removeChat, storeChat } from "./chatStorage";

/** Backup starts after local persistence and never delays its queue. */
function uploadPending(): void {
  void storeSession
    .initSession()
    .then(async (session) => {
      if (session.status === "ready" || session.status === "upload-only") await session.sync.flushPending();
    })
    .catch((error) => console.warn("Couldn't back up pending chats", error));
}

/** Local persistence owns durability and retention; backup consumes its outbox. */
export const syncedChatStorage = {
  index: loadChatIndex,
  load: (id: string) => loadChat(id, false),
  store: async (chat: Chat): Promise<void> => {
    await storeChat(chat);
    uploadPending();
  },
  remove: async (id: string): Promise<void> => {
    await removeChat(id);
    uploadPending();
  },
};
