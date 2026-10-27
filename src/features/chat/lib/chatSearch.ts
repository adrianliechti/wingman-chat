import type { UIMessage } from "@tanstack/ai";
import { messageMetadata, messageText } from "@/shared/lib/messages";

export type ChatSearchMatch = {
  /** Absent when only the conversation title matches. */
  messageId?: string;
  excerpt: string;
};

/** Keep enough context on either side of the first match for a compact sidebar preview. */
export function searchExcerpt(content: string, query: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  const offset = text.toLowerCase().indexOf(query.toLowerCase().replace(/\s+/g, " ").trim());
  const start = Math.max(0, offset - 45);
  const end = Math.min(text.length, Math.max(start + 160, offset + query.length + 45));
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function firstMessageMatch(messages: UIMessage[], query: string): ChatSearchMatch | undefined {
  const normalized = query.toLowerCase();
  for (const message of messages) {
    // These messages have no visible passage to navigate to.
    if (message.role === "system" || messageMetadata(message).kind || messageMetadata(message).error) continue;
    const text = messageText(message);
    if (text.toLowerCase().includes(normalized)) {
      return { messageId: message.id, excerpt: searchExcerpt(text, query) };
    }
  }
  return undefined;
}
