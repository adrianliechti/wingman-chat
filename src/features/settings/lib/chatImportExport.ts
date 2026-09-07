import * as opfs from "@/shared/lib/opfs";
import { storeChat, removeChat } from "@/features/chat/lib/chatStorage";
import { readZipFiles, restoreFiles } from "@/shared/lib/opfs-restore";
import { migrateChat } from "./v1Migration";

/**
 * Import chats from a ZIP file into the OPFS chats folder.
 * Merges with existing chats.
 *
 * Rejects archives that don't look like a chats export; merging an unrelated
 * collection would pollute chats/ with folders the index rebuild then surfaces
 * as phantom chats.
 */
export async function importChatsFromZip(file: Blob): Promise<void> {
  const files = await readZipFiles(file);
  const paths = [...files.keys()];
  const prefixed = paths.some((path) => path.startsWith("chats/"));
  const flat = files.has("chat.json");
  const flatId = flat ? JSON.parse(await files.get("chat.json")!.text()).id || crypto.randomUUID() : undefined;
  if (!prefixed && !paths.some((path) => /(^|\/)chat\.json$/.test(path))) {
    throw new Error("Unrecognized archive: expected a chats export.");
  }

  const mapped = new Map<string, Blob>();
  for (const [path, blob] of files) {
    if (prefixed && !path.startsWith("chats/")) continue;
    mapped.set(prefixed ? path : flat ? `chats/${flatId}/${path}` : `chats/${path}`, blob);
  }
  await restoreFiles(mapped);
}

/**
 * Import chats from a legacy JSON export (`{ chats: [...] }`).
 * Each chat is migrated to the current schema via `migrateChat`.
 *
 * @returns The number of successfully imported chats and failures.
 */
export async function importChatsFromLegacyJson(
  jsonData: string,
): Promise<{ total: number; imported: number; failed: number }> {
  const importData = JSON.parse(jsonData);

  if (!importData.chats || !Array.isArray(importData.chats)) {
    throw new Error("Invalid import file: Expected chats array not found.");
  }

  const total = importData.chats.length;
  let imported = 0;

  for (const chatData of importData.chats) {
    const newChatId = crypto.randomUUID();
    try {
      const migratedChat = migrateChat(chatData);

      if (chatData.artifacts && typeof chatData.artifacts === "object") {
        await opfs.saveArtifacts(newChatId, chatData.artifacts);
      }

      await storeChat({ ...migratedChat, id: newChatId });

      imported++;
    } catch (error) {
      await removeChat(newChatId).catch((cleanupError) => console.error("Import cleanup failed:", cleanupError));
      console.error("Failed to import chat:", error);
    }
  }

  return { total, imported, failed: total - imported };
}

/**
 * Export all chats as a ZIP download.
 */
export async function exportChatsAsZip(): Promise<void> {
  const filename = `wingman-chats-${new Date().toISOString().split("T")[0]}.zip`;
  await opfs.downloadFolderAsZip("chats", filename);
}
