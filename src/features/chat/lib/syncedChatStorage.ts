import * as storeSession from "@/shared/lib/storeSession";
import type { Chat } from "@/shared/types/chat";
import { loadChat, loadChatIndex, removeChat, storeChat } from "./chatStorage";

const UPLOAD_DELAY_MS = 1000;
let uploadTimer: ReturnType<typeof setTimeout> | undefined;

/** Backup starts after local persistence; saves within one window share a flush. */
function uploadPending(): void {
  if (uploadTimer) return;
  uploadTimer = setTimeout(() => {
    uploadTimer = undefined;
    void storeSession
      .initSession()
      .then(async (session) => {
        if (session.status === "ready") await session.sync.flushPending();
      })
      .catch((error) => console.warn("Couldn't back up pending chats", error));
  }, UPLOAD_DELAY_MS);
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
