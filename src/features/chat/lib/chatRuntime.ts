import type { ChatPersistedState } from "@tanstack/ai-client";
import type { SubagentPart } from "@tanstack/ai";
import { aiMessageState, fromAIMessages, reasoningState, type AIMessageState } from "@/shared/lib/aiMessages";
import { readJson, type StoredChat } from "@/shared/lib/opfs";
import type { Chat, Content, Message } from "@/shared/types/chat";

/** Adapter state belongs to the live record, never to Chat or chat.json. */
export interface ChatRuntime extends AIMessageState {
  resume?: ChatPersistedState["resume"];
  metadata?: Record<string, Record<string, unknown>>;
}
export interface ChatRecord extends Chat {
  runtime?: ChatRuntime;
}

interface StoredRuntime extends ChatRuntime {
  version: 1;
  messagesHash: string;
}

async function messagesHash(messages: Message[]): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function serializeChatRuntime(
  messages: Message[],
  runtime?: ChatRuntime,
): Promise<StoredRuntime | undefined> {
  if (!runtime || !Object.values(runtime).some(Boolean)) return undefined;
  return { version: 1, messagesHash: await messagesHash(messages), ...runtime };
}

/** Read the earlier branch format once; the next save writes only owned content. */
export async function restoreChatRuntime(stored: StoredChat): Promise<Pick<ChatRecord, "messages" | "runtime">> {
  const legacy = stored as StoredChat & { aiResume?: ChatRuntime["resume"]; aiMetadata?: ChatRuntime["metadata"] };
  let runtime: ChatRuntime = { resume: legacy.aiResume, metadata: legacy.aiMetadata };
  try {
    const saved = await readJson<StoredRuntime>(`chats/${stored.id}/tanstack.json`);
    // Partial writes/restores must never resume tools against a different transcript.
    if (saved?.version === 1 && saved.messagesHash === (await messagesHash(stored.messages))) {
      runtime = { resume: saved.resume, metadata: saved.metadata, subagents: saved.subagents };
    }
  } catch (error) {
    console.warn("Could not restore optional AI runtime state:", error);
  }
  const normalize = (messages: Message[]): Message[] =>
    messages.map((message) => ({
      ...message,
      content: message.content.map((part): Content => {
        if (part.type === "subagent") {
          if ("subagent" in part) {
            const native = [
              { id: message.id ?? "legacy", role: message.role, parts: [part as unknown as SubagentPart] },
            ];
            runtime.subagents = { ...runtime.subagents, ...aiMessageState(native).subagents };
            return fromAIMessages(native)[0].content[0];
          }
          return { ...part, messages: normalize(part.messages) };
        }
        if (part.type === "reasoning" && "signature" in part && typeof part.signature === "string") {
          const { signature, ...reasoning } = part;
          return { ...reasoning, ...reasoningState(signature) };
        }
        return part;
      }),
    }));
  const messages = normalize(stored.messages);
  return { messages, runtime: Object.values(runtime).some(Boolean) ? runtime : undefined };
}
