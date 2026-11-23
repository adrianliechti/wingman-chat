import { requireChatBackupReady } from "./chatBackupActivity";
import { appendChatBatch, appendEvents, type ChatAppend } from "./storeClient";

export const CHAT_APPEND_BATCH_SIZE = 8;
const MAX_BATCH_ENTRY_BYTES = 1 << 20;
const BATCH_WAIT_MS = 12;

type Result = Awaited<ReturnType<typeof appendEvents>>;

interface PendingAppend {
  write: ChatAppend;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
}

/** Collect prepared appends from one group of independently locked chats. */
export function createChatAppendBatch(): typeof appendEvents {
  let pending: PendingAppend[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    const queued = pending;
    pending = [];
    const ready = queued.filter(({ write, reject }) => {
      try {
        requireChatBackupReady(write.id);
        return true;
      } catch (error) {
        reject(error);
        return false;
      }
    });

    try {
      const results = ready.length > 1 ? await appendChatBatch(ready.map(({ write }) => write)) : null;
      if (results) {
        ready.forEach(({ resolve }, index) => resolve(results[index]));
        return;
      }
    } catch (error) {
      ready.forEach(({ reject }) => reject(error));
      return;
    }

    // Keep the existing endpoint for single appends, older servers and
    // whole-batch precondition failures. One failure must not block the rest.
    for (const { write, resolve, reject } of ready) {
      try {
        requireChatBackupReady(write.id);
        resolve(await appendEvents(write.id, write.expectedSeq, write.events));
      } catch (error) {
        reject(error);
      }
    }
  }

  return (id, expectedSeq, events) => {
    const write = { id, expectedSeq, events };
    if (
      events.reduce((size, event) => size + event.frame.length, 0) > MAX_BATCH_ENTRY_BYTES ||
      new Blob([JSON.stringify(write)]).size > MAX_BATCH_ENTRY_BYTES
    ) {
      return appendEvents(id, expectedSeq, events);
    }
    return new Promise((resolve, reject) => {
      pending.push({ write, resolve, reject });
      if (pending.length === CHAT_APPEND_BATCH_SIZE) void flush();
      else timer ??= setTimeout(() => void flush(), BATCH_WAIT_MS);
    });
  };
}
