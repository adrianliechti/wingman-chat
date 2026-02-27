import * as opfs from '@/shared/lib/opfs';
import { migrateChat } from './v1Migration';

/**
 * Import chats from a ZIP file into the OPFS chats folder.
 * Merges with existing chats.
 */
export async function importChatsFromZip(file: File): Promise<void> {
  await opfs.importFolderFromZip('chats', file);
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
    throw new Error('Invalid import file: Expected chats array not found.');
  }

  const total = importData.chats.length;
  let imported = 0;

  for (const chatData of importData.chats) {
    try {
      const migratedChat = migrateChat(chatData);
      const newChatId = crypto.randomUUID();

      const stored = await opfs.extractChatBlobs({
        ...migratedChat,
        id: newChatId,
      });

      await opfs.writeJson(`chats/${stored.id}/chat.json`, stored);

      if (chatData.artifacts && typeof chatData.artifacts === 'object') {
        await opfs.saveArtifacts(newChatId, chatData.artifacts);
      }

      await opfs.upsertIndexEntry('chats', {
        id: stored.id,
        title: stored.title,
        updated: stored.updated || new Date().toISOString(),
      });

      imported++;
    } catch (error) {
      console.error('Failed to import chat:', chatData, error);
    }
  }

  return { total, imported, failed: total - imported };
}

/**
 * Export all chats as a ZIP download.
 */
export async function exportChatsAsZip(): Promise<void> {
  const filename = `wingman-chats-${new Date().toISOString().split('T')[0]}.zip`;
  await opfs.downloadFolderAsZip('chats', filename);
}
