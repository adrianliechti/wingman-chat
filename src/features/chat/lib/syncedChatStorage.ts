import { readLocalChat, readLocalMirror, stashPendingTarget, stashPendingDeletion } from "@/shared/lib/chatSync";
import * as storeSession from "@/shared/lib/storeSession";
import type { Chat } from "@/shared/types/chat";
import { chatEntry } from "./chatStorage";

/** The server log supplies manifests; attachments remain lazy, as in local storage. */
export const syncedChatStorage = {
  index: async () => (await readLocalMirror(false)).map(chatEntry),
  load: (id: string) => readLocalChat(id, false),
  store: async (chat: Chat): Promise<void> => {
    const session = await storeSession.initSession();
    if (session.status !== "ready" && session.status !== "upload-only") return stashPendingTarget(chat);
    try {
      await session.sync.saveChat(chat);
    } catch {
      await stashPendingTarget(chat);
    }
  },
  remove: async (id: string): Promise<void> => {
    const current = await storeSession.initSession();
    if (current.status === "setup") return stashPendingDeletion(id, current.userId);
    const session = await storeSession.whenUploading();
    await session.sync.deleteChat(id);
  },
};
