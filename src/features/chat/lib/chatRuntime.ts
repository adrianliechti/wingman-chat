import type { MetadataStore } from "@tanstack/ai";
import type { ChatPendingInterrupt, ChatPersistedState } from "@tanstack/ai-client";
import { aiSignature, readAISignature } from "@/shared/lib/aiMessages";
import type { Compaction, Interrupt, PendingRun } from "@/shared/types/chat";

/** Namespace @tanstack/ai-compaction keeps its checkpoints under. */
const CHECKPOINT_NAMESPACE = "@tanstack/ai-compaction";
const SUMMARY = /<untrusted-conversation-summary>\n([\s\S]*?)\n<\/untrusted-conversation-summary>/;
/** Interrupt metadata keys that only the runtime reads (e.g. its resume binding). */
const RUNTIME_METADATA = "tanstack:";

type ChatResume = ChatPersistedState["resume"];

/** The client tells interrupts apart by which keys are present, so absent fields must stay absent. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** The chat's pending run as ChatClient's resume snapshot. */
export function toResume(chatId: string, run?: PendingRun): ChatResume {
  if (!run) return undefined;
  return {
    resumeState: { threadId: readAISignature<{ threadId: string }>(run.signature)?.threadId ?? chatId, runId: run.id },
    pendingInterrupts: run.interrupts.map(({ subagentId, schema, metadata, signature, ...interrupt }) => {
      const merged = { ...metadata, ...readAISignature<Record<string, unknown>>(signature) };
      return defined<ChatPendingInterrupt>({
        ...interrupt,
        subagentRunId: subagentId,
        responseSchema: schema,
        metadata: Object.keys(merged).length ? merged : undefined,
      });
    }),
  };
}

/** Only a run waiting on interrupts is kept; a bare in-flight run cannot outlive the page. */
export function fromResume(resume: ChatResume): PendingRun | undefined {
  if (!resume?.pendingInterrupts?.length) return undefined;
  const { threadId, runId } = resume.resumeState;
  return defined<PendingRun>({
    id: runId,
    interrupts: resume.pendingInterrupts.map(
      ({ id, reason, message, toolCallId, subagentRunId, responseSchema, expiresAt, metadata = {} }) => {
        const runtime = Object.entries(metadata).filter(([key]) => key.startsWith(RUNTIME_METADATA));
        const readable = Object.entries(metadata).filter(([key]) => !key.startsWith(RUNTIME_METADATA));
        return defined<Interrupt>({
          id,
          reason,
          message,
          toolCallId,
          subagentId: subagentRunId,
          schema: responseSchema,
          expiresAt,
          metadata: readable.length ? Object.fromEntries(readable) : undefined,
          signature: aiSignature(Object.fromEntries(runtime)),
        });
      },
    ),
    signature: aiSignature({ threadId }),
  });
}

function summaryText(checkpoint: unknown): string | undefined {
  const messages = (checkpoint as { compactedMessages?: { content?: unknown }[] } | null)?.compactedMessages ?? [];
  for (const { content } of messages) {
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part: { content?: unknown }) => (typeof part.content === "string" ? part.content : ""))
              .join("")
          : "";
    const summary = SUMMARY.exec(text)?.[1];
    if (summary) return summary;
  }
  return undefined;
}

/**
 * Compaction checkpoints live on the chat, one per context (the chat or a
 * subagent). The runtime validates a checkpoint against the current prefix,
 * so a stale one is recomputed and replaced rather than reused.
 */
export function compactionStore(
  read: () => Compaction[] | undefined,
  write: (update: (compactions: Compaction[]) => Compaction[]) => void,
  subagentId?: string,
): MetadataStore {
  const others = (compactions: Compaction[]) => compactions.filter((item) => item.subagentId !== subagentId);
  return {
    get: async (namespace) =>
      namespace === CHECKPOINT_NAMESPACE
        ? (readAISignature(read()?.find((item) => item.subagentId === subagentId)?.signature) ?? null)
        : null,
    set: async (namespace, _key, value) => {
      if (namespace !== CHECKPOINT_NAMESPACE) return;
      const text = summaryText(value);
      const signature = aiSignature(value as Record<string, unknown>);
      if (!signature) return;
      write((compactions) => [
        ...others(compactions),
        { ...(subagentId ? { subagentId } : {}), ...(text ? { text } : {}), signature },
      ]);
    },
    delete: async (namespace) => {
      if (namespace === CHECKPOINT_NAMESPACE) write(others);
    },
  };
}
