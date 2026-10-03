import type { MetadataStore, UIMessage } from "@tanstack/ai";
import { messageMetadata } from "@/shared/lib/messages";
import type { ChatMetadata, MessageError } from "@/shared/types/chat";

/**
 * Middleware state lives on the chat, namespaced the way TanStack's metadata
 * capability expects. A subagent's context is scoped under the same thread so
 * its checkpoints never collide with the chat's own.
 */
export function chatMetadataStore(
  read: () => ChatMetadata | undefined,
  write: (update: (metadata: ChatMetadata) => ChatMetadata) => void,
  subagentRunId?: string,
): MetadataStore {
  const scoped = (key: string) => (subagentRunId ? `${key}/${subagentRunId}` : key);
  return {
    get: async (namespace, key) => read()?.[namespace]?.[scoped(key)] ?? null,
    set: async (namespace, key, value) =>
      write((metadata) => ({ ...metadata, [namespace]: { ...metadata[namespace], [scoped(key)]: value } })),
    delete: async (namespace, key) =>
      write((metadata) => {
        const { [scoped(key)]: _removed, ...rest } = metadata[namespace] ?? {};
        return { ...metadata, [namespace]: rest };
      }),
  };
}

/** The native transcript without the empty assistant TanStack opens for a run that produced nothing. */
function withoutTrailingEmptyAssistant(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1);
  return last?.role === "assistant" && !last.parts.length && !messageMetadata(last).error
    ? messages.slice(0, -1)
    : messages;
}

/** A failed run ends with its own assistant turn so the transcript shows the error and offers a retry. */
export function withRunError(messages: UIMessage[], error: MessageError): UIMessage[] {
  return [
    ...withoutTrailingEmptyAssistant(messages),
    { id: crypto.randomUUID(), role: "assistant", parts: [], createdAt: new Date(), metadata: { error } },
  ];
}

/**
 * What a retry resends: the transcript up to the last committed work. Tool
 * results stay so the model continues from them; a partial answer, an
 * unanswered tool call, or reasoning without an answer is regenerated.
 */
export function retryHistory(messages: UIMessage[]): { history: UIMessage[]; resend: UIMessage } | undefined {
  const trimmed = withoutTrailingEmptyAssistant(messages);
  const failed = trimmed.at(-1);
  if (failed?.role !== "assistant" || !messageMetadata(failed).error) return undefined;
  const { error: _error, ...metadata } = failed.metadata!;
  const history = [...trimmed.slice(0, -1), { ...failed, metadata }];
  while (history.length) {
    const last = history[history.length - 1];
    if (last.role !== "assistant") break;
    const committed = last.parts.findLastIndex((part) => part.type === "tool-result");
    if (committed >= 0) {
      history[history.length - 1] = { ...last, parts: last.parts.slice(0, committed + 1) };
      break;
    }
    history.pop();
  }
  if (!history.some((message) => message.role === "user")) return undefined;
  return { history: history.slice(0, -1), resend: history[history.length - 1] };
}
