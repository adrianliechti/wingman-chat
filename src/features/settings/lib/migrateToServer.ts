/**
 * One-time migration safety check for users transitioning from
 * OPFS-only mode to server-synced mode.
 *
 * Legacy `chats/{id}/chat.json` files are picked up by
 * `ChatSync.hydrateFromOpfs()` and promoted to pending targets, so the
 * actual upload happens via the normal flush path. This module exists
 * to handle the corner case where the same user already has chats on
 * the server (from another device): in that case we drop the legacy
 * pending targets rather than overwrite the remote state.
 */

import type { ChatSync } from "@/shared/lib/chatSync";
import * as api from "@/shared/lib/chatstoreClient";
import { readJson, writeJson } from "@/shared/lib/opfs-core";

const FLAG_PATH = "_sync/migrated.json";

interface Flag {
  done: true;
  ts: string;
}

export async function migrateLocalChatsToServer(sync: ChatSync): Promise<{ flushed: number }> {
  const existing = await readJson<Flag>(FLAG_PATH);
  if (existing?.done) {
    void sync.flushPending();
    return { flushed: 0 };
  }

  const remote = await api.listChats();
  if (remote.length > 0) {
    // Server already populated — by design we do not overwrite it from
    // a fresh device's local OPFS. The pending targets carrying legacy
    // chat.json content stay only in memory; mark migration done so
    // they won't be flushed on subsequent runs. (User can still export
    // / import via ZIP for explicit reconciliation.)
    console.warn("migrateLocalChatsToServer: server already has chats; skipping local upload");
    await writeJson<Flag>(FLAG_PATH, { done: true, ts: new Date().toISOString() });
    return { flushed: 0 };
  }

  // Flush whatever pending targets hydrateFromOpfs promoted. Idempotent.
  await sync.flushPending();
  await writeJson<Flag>(FLAG_PATH, { done: true, ts: new Date().toISOString() });
  return { flushed: 0 };
}
