import type { Content, Message, ReasoningContent } from "../types/chat";

/** Reasoning can be replayed only when its provider payload and identity are retained. */
export function isReplayableReasoning(part: Content): part is ReasoningContent {
  return part.type === "reasoning" && !!part.encryptedContent && !!part.id;
}

/** Drop the payloads while keeping visible reasoning text. Returns the same array when nothing changed. */
export function clearReplayableReasoning(messages: Message[]): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.content.some(isReplayableReasoning)) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part): Content => {
        if (!isReplayableReasoning(part)) return part;
        const visible: ReasoningContent = { type: "reasoning", id: part.id, text: part.text };
        if (part.summary) visible.summary = part.summary;
        return visible;
      }),
    };
  });
  return changed ? next : messages;
}
