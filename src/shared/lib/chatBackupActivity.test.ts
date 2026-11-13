import { expect, it, vi } from "vitest";
import {
  beginChatBackupPause,
  finishChatBackupPause,
  finishStoppedChatBackups,
  isChatBackupPaused,
  areFileBackupsPaused,
  onChatBackupReady,
} from "./chatBackupActivity";
import { PersistenceQueue, registerPersistenceQueue } from "./persistence";

it("flushes the final local write before allowing backup and keeps nested requests paused", async () => {
  const events: string[] = [];
  const queue = new PersistenceQueue(vi.fn(), 60_000);
  const unregister = registerPersistenceQueue(queue);
  const unsubscribe = onChatBackupReady(() => events.push("backup"));
  const outer = beginChatBackupPause("chat");
  const inner = beginChatBackupPause("chat");
  try {
    queue.schedule("chat", async () => {
      events.push("local final state");
    });
    await finishChatBackupPause(inner);
    expect(isChatBackupPaused("chat")).toBe(true);
    expect(areFileBackupsPaused()).toBe(true);
    expect(events).toEqual(["local final state"]);
    await finishChatBackupPause(outer);
    expect(events).toEqual(["local final state", "backup"]);
    expect(areFileBackupsPaused()).toBe(false);
    outer();
    expect(events).toHaveLength(2);
  } finally {
    inner();
    outer();
    unsubscribe();
    unregister();
    await queue.stop();
  }
});

it("a stopped request cannot release a newer request's backup hold", async () => {
  const old = beginChatBackupPause("chat");
  const stopped = finishStoppedChatBackups("chat");
  const newer = beginChatBackupPause("chat");
  try {
    await stopped;
    old();
    expect(isChatBackupPaused("chat")).toBe(true);
  } finally {
    old();
    newer();
  }
  expect(isChatBackupPaused("chat")).toBe(false);
});
