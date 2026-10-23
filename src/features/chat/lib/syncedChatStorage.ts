import { readLocalChat, readLocalMirror, stashPendingTarget } from "@/shared/lib/chatSync";
import * as storeSession from "@/shared/lib/storeSession";
import type { Chat } from "@/shared/types/chat";
import { chatEntry } from "./chatStorage";

/** The server log supplies manifests; attachments remain lazy, as in local storage. */
export const syncedChatStorage = {
  index: async () => (await readLocalMirror(false)).map(chatEntry),
  load: (id: string) => readLocalChat(id, false),
  store: async (chat: Chat): Promise<void> => {
    const session = await storeSession.initSession();
    if (session.status !== "ready") return stashPendingTarget(chat);
    try {
      await session.sync.saveChat(chat);
    } catch {
      await stashPendingTarget(chat);
    }
  },
  remove: async (id: string): Promise<void> => {
    const session = await storeSession.whenReady();
    await session.sync.deleteChat(id);
  },
};
