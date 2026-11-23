import { createRoot } from "react-dom/client";
import { SyncSection } from "../../../src/features/settings/components/SyncSection";
import { ConfirmHost } from "../../../src/shell/components/ConfirmHost";
import { forgetBackup } from "../../../src/shared/lib/rememberedBackup";
import { initSession } from "../../../src/shared/lib/storeSession";
import { loadConfig } from "../../../src/shared/config";
import { clearAll, deleteDirectory, deleteFile, readText, writeText } from "../../../src/shared/lib/opfs-core";
import { syncedChatStorage } from "../../../src/features/chat/lib/syncedChatStorage";
import { readLocalChat } from "../../../src/shared/lib/localChats";
import { mediaFromDataUrl, text, userMessage } from "../../../src/shared/lib/messages";
import "../../../src/index.css";

declare global {
  interface Window {
    syncSecurityE2E: {
      forgetUnlock(): Promise<void>;
      save(path: string, value: string): Promise<void>;
      read(path: string): Promise<string | undefined>;
      clear(): Promise<void>;
      sessionStatus(): Promise<string>;
      saveChat(text: string, id?: string): Promise<void>;
      appendChat(text: string, attachment: string): Promise<void>;
      readChat(id?: string): Promise<unknown>;
      removeChat(id: string): Promise<void>;
      removeFile(path: string): Promise<void>;
      removeDirectory(path: string): Promise<void>;
    };
  }
}
window.syncSecurityE2E = {
  forgetUnlock: forgetBackup,
  save: writeText,
  read: readText,
  clear: clearAll,
  sessionStatus: async () => (await initSession()).status,
  saveChat: (text, id = "reset-chat") =>
    syncedChatStorage.store({
      id,
      created: new Date("2026-01-01"),
      updated: new Date(),
      model: null,
      messages: [userMessage(text)],
    }),
  readChat: (id = "reset-chat") => readLocalChat(id, false),
  appendChat: async (message, attachment) => {
    const chat = await readLocalChat("reset-chat");
    if (!chat) throw new Error("Expected an existing backup chat");
    await syncedChatStorage.store({
      ...chat,
      updated: new Date(),
      messages: [...chat.messages, userMessage([text(message), mediaFromDataUrl(attachment, `${message}.png`)])],
    });
  },
  removeChat: syncedChatStorage.remove,
  removeFile: deleteFile,
  removeDirectory: deleteDirectory,
};
await loadConfig();
createRoot(document.getElementById("root")!).render(
  <>
    <main aria-label="Sync and security settings" className="h-full overflow-y-auto p-6">
      <div className="flex min-h-full flex-col">
        <SyncSection />
      </div>
    </main>
    <ConfirmHost />
  </>,
);
