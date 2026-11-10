import { decodeLines, encodeLines, replayLog, type LogEntry } from "./chatLog";
import { readBlob } from "./opfs-core";
import type { StoredChat } from "./opfs-chat";

export interface ChatCheckpoint {
  head: number;
  hash: string;
  count: number;
}

type HistoryEntry = LogEntry | ({ type: "checkpoint" } & ChatCheckpoint);

export const chatHistoryPath = (id: string) => `chats/${id}/history.jsonl`;

/** The entries and their checkpoint close in the same atomic OPFS write. */
export function encodeHistory(entries: LogEntry[], checkpoint: ChatCheckpoint): string {
  return encodeLines(entries) + JSON.stringify({ type: "checkpoint", ...checkpoint }) + "\n";
}

export async function readChatHistory(id: string, known?: { head: number; hash: string; chat: StoredChat }) {
  const file = await readBlob(chatHistoryPath(id));
  if (!file?.size) return undefined;
  // Check only the trailing checkpoint before deciding whether to replay a
  // potentially large log. Older logs replay in full until their next commit.
  const start = Math.max(0, file.size - 1024);
  const tail = (await file.slice(start).text()).trimEnd();
  const boundary = tail.lastIndexOf("\n");
  let checkpoint: ChatCheckpoint | undefined;
  if (start === 0 || boundary >= 0) {
    const last = JSON.parse(tail.slice(boundary + 1)) as HistoryEntry;
    if (last.type === "checkpoint") checkpoint = { head: last.head, hash: last.hash, count: last.count };
  }
  if (known && checkpoint?.head === known.head && checkpoint.hash === known.hash)
    return { chat: known.chat, checkpoint };

  const entries: LogEntry[] = [];
  for (const entry of decodeLines(await file.text()) as HistoryEntry[]) {
    if (entry.type !== "checkpoint") entries.push(entry);
  }
  // Older histories use the separately stored checkpoint until their next write.
  return { chat: replayLog(id, entries).chat, checkpoint };
}
