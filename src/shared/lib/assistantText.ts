import type { Content, TextContent } from "../types/chat";

/** Prefer the last explicit final answer, or the last unphased message from older providers. */
export function selectFinalAssistantMessage<T extends { phase?: TextContent["phase"] | null }>(
  messages: readonly T[],
): T | undefined {
  return (
    messages.findLast((message) => message.phase === "final_answer") ?? messages.findLast((message) => !message.phase)
  );
}

/** For model results consumed by tools. Chat display/search can still use getTextFromContent. */
export function getFinalTextFromContent(content: Content[]): string {
  return selectFinalAssistantMessage(content.filter((part): part is TextContent => part.type === "text"))?.text ?? "";
}
