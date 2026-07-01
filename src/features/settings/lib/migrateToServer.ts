/**
 * Reconciliation for chats that exist locally but were never synced —
 * legacy OPFS-only chats promoted by `ChatSync.hydrateFromOpfs()`, or
 * chats created while the server was unreachable.
 *
 * Chat ids are UUIDs, so plain union is safe: ids unknown to the server
 * are flushed through the normal save path. An id the server already
 * knows means the same chat diverged (synced once, then used offline);
 * last write wins by `updated` timestamp, matching the sync engine's
 * conflict policy everywhere else.
 */

import type { ChatSync } from "@/shared/lib/chatSync";
import * as api from "@/shared/lib/chatstoreClient";

export async function migrateLocalChatsToServer(sync: ChatSync): Promise<{ uploaded: number; dropped: number }> {
  const unsynced = sync.unsyncedChats();
  if (unsynced.length === 0) {
    await sync.flushPending();
    return { uploaded: 0, dropped: 0 };
  }

  const remote = await api.listChats();
  const remoteById = new Map(remote.map((r) => [r.id, r]));

  const upload: string[] = [];
  let dropped = 0;

  for (const { id, updated } of unsynced) {
    const server = remoteById.get(id);
    if (server) {
      const localTime = updated ? Date.parse(updated) : 0;
      const serverTime = Date.parse(server.updated) || 0;
      if (localTime <= serverTime) {
        await sync.dropUnsyncedChat(id);
        dropped++;
        continue;
      }
    }
    upload.push(id);
  }

  // saveChat uploads blobs itself, but these targets were hydrated from
  // disk — push their blobs before the events reference them.
  for (const id of upload) {
    await sync.ensureBlobsUploaded(id);
  }

  if (dropped > 0) {
    console.log(`chat reconciliation: dropped ${dropped} local chat(s) superseded by server versions`);
  }
  if (upload.length > 0) {
    console.log(`chat reconciliation: uploading ${upload.length} local-only chat(s)`);
  }

  await sync.flushPending();
  return { uploaded: upload.length, dropped };
}
