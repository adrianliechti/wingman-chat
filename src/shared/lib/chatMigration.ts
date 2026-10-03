/**
 * One-way migration of chats saved before the native transcript (stored
 * record version 2). The old record kept Wingman's own `Message[]` with tool
 * outputs as user turns and runtime state in opaque `@tanstack:` signatures.
 * The result is deterministic, so a chat that is loaded but never saved again
 * migrates to the same record each time.
 */

import type { SubagentPart, ToolCallPart, UIMessage } from "@tanstack/ai";
import type { Chat, MessageError, MessageUsage, Model } from "@/shared/types/chat";
import {
  artifactRefPart,
  artifactSelectionPart,
  describeToolOutput,
  mediaFromDataUrl,
  text,
  type ArtifactRef,
  type ArtifactSelection,
  type MediaPart,
  type MessageMetadata,
  type TextMetadata,
  type TextSegment,
  type ToolResultMetadata,
} from "./messages";
import { STORED_CHAT_VERSION, type StoredChat } from "./opfs-chat";
import { packGatewayReasoning } from "./reasoning";

// ── The old record ─────────────────────────────────────────────────────────

type LegacyMedia = { type: "image" | "audio" | "file"; name?: string; data: string; contentType?: string };
type LegacyText = { type: "text"; text: string; phase?: TextSegment["phase"] };
type LegacyReasoning = {
  type: "reasoning";
  id: string;
  text: string;
  summary?: string;
  encryptedContent?: string;
  model?: string;
};
type LegacyToolCall = { type: "tool_call"; id: string; name: string; arguments: string; incomplete?: boolean };
type LegacyToolResult = {
  type: "tool_result";
  id: string;
  name: string;
  arguments: string;
  meta?: Record<string, unknown>;
  result: (LegacyText | LegacyMedia)[];
  content?: Record<string, unknown>;
};
type LegacySubagent = {
  type: "subagent";
  id: string;
  name: string;
  description?: string;
  runId?: string;
  toolCallId?: string;
  status: SubagentPart["subagent"]["status"];
  messages: LegacyMessage[];
  error?: { message: string; code?: string };
  signature?: string;
};
type LegacyContent =
  | LegacyText
  | LegacyMedia
  | LegacyReasoning
  | LegacyToolCall
  | LegacyToolResult
  | { type: "summary"; text: string }
  | ({ type: "artifact_ref" } & ArtifactRef)
  | ({ type: "artifact_selection" } & ArtifactSelection)
  | { type: "runtime_feedback"; source: "verification" | "guardrail"; text: string }
  | LegacySubagent;

export interface LegacyMessage {
  id?: string;
  runId?: string;
  createdAt?: string;
  role: "user" | "assistant";
  content: LegacyContent[];
  usage?: MessageUsage;
  error?: MessageError | null;
}

interface LegacyInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  subagentId?: string;
  schema?: Record<string, unknown>;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  signature?: string;
}

export interface LegacyStoredChat {
  version?: undefined;
  id: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;
  created: string | null;
  updated: string | null;
  model: Model | null;
  messages: LegacyMessage[];
  pendingRun?: { id: string; interrupts: LegacyInterrupt[]; signature?: string };
  compactions?: { subagentId?: string; text?: string; signature: string }[];
}

export function isLegacyStoredChat(stored: { version?: unknown; messages?: unknown[] }): stored is LegacyStoredChat {
  return (
    stored.version !== STORED_CHAT_VERSION &&
    Array.isArray(stored.messages) &&
    stored.messages.every((message) => !!message && typeof message === "object" && !("parts" in message))
  );
}

/** Data the old runtime signed under its realm tag; anything else reads as absent. */
function readSignature<T>(signature: string | undefined): T | undefined {
  if (!signature?.startsWith("@tanstack:")) return undefined;
  try {
    return JSON.parse(signature.slice("@tanstack:".length)) as T;
  } catch {
    return undefined;
  }
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

// ── Messages ───────────────────────────────────────────────────────────────

function media(part: LegacyMedia): MediaPart {
  const kind = part.type === "file" ? "document" : part.type;
  if (part.data.startsWith("data:")) return mediaFromDataUrl(part.data, part.name, kind);
  // A blob reference or external URL stays a reference; the stored type is kept for rehydration.
  return {
    type: kind,
    source: { type: "url", value: part.data },
    metadata: defined({ filename: part.name, contentType: part.contentType }),
  } as MediaPart;
}

function result(parts: LegacyToolResult["result"]) {
  return parts.map((part) => (part.type === "text" ? text(part.text) : media(part)));
}

/** Pending approvals keep their native tool-call state so the interrupt card can resume them. */
function approvalFor(toolCallId: string, chat: LegacyStoredChat) {
  const interrupt = chat.pendingRun?.interrupts.find(
    (item) => item.toolCallId === toolCallId && (item.reason === "tool_call" || item.reason === "approval_required"),
  );
  return interrupt ? { id: interrupt.id, needsApproval: true } : undefined;
}

export function migrateLegacyMessages(messages: LegacyMessage[], chat: LegacyStoredChat, scope = chat.id): UIMessage[] {
  const answered = new Set(
    messages.flatMap((message) => message.content.flatMap((part) => (part.type === "tool_result" ? [part.id] : []))),
  );
  const fallbackCreatedAt = chat.created ?? new Date(0).toISOString();
  const native: UIMessage[] = [];
  const owners = new Map<string, UIMessage>();

  messages.forEach((message, index) => {
    const kinds = new Set(message.content.map((part) => part.type));
    const kind: MessageMetadata["kind"] | undefined =
      kinds.size === 1 && kinds.has("summary")
        ? "summary"
        : kinds.size === 1 && kinds.has("runtime_feedback")
          ? "runtime_feedback"
          : undefined;
    const segments = message.content.flatMap((part): TextSegment[] =>
      part.type === "text" ? [{ content: part.text, phase: part.phase }] : [],
    );
    const metadata: MessageMetadata = defined({
      runId: message.runId,
      usage: message.usage,
      error: message.role === "assistant" ? (message.error ?? undefined) : undefined,
      kind,
      textSegments: segments.some((segment) => segment.phase) ? segments : undefined,
    });
    const next: UIMessage = {
      id: message.id ?? `legacy-${scope}-${index}`,
      role: message.role,
      parts: [],
      createdAt: new Date(message.createdAt ?? fallbackCreatedAt),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };

    for (const part of message.content) {
      switch (part.type) {
        case "text": {
          const textMetadata: TextMetadata = defined({ phase: part.phase });
          next.parts.push(text(part.text, Object.keys(textMetadata).length ? textMetadata : undefined));
          break;
        }
        case "summary":
          next.parts.push(text(part.text));
          break;
        case "runtime_feedback":
          next.parts.push(text(part.text, { source: part.source }));
          break;
        case "artifact_ref":
          next.parts.push(
            artifactRefPart(
              defined({ path: part.path, revision: part.revision, displayName: part.displayName, jobId: part.jobId }),
            ),
          );
          break;
        case "artifact_selection":
          next.parts.push(
            artifactSelectionPart(
              defined({ path: part.path, text: part.text, startLine: part.startLine, endLine: part.endLine }),
            ),
          );
          break;
        case "image":
        case "audio":
        case "file":
          next.parts.push(media(part));
          break;
        case "reasoning":
          next.parts.push({
            type: "thinking",
            content: part.summary ?? part.text,
            stepId: part.id,
            signature: packGatewayReasoning({
              id: part.id,
              text: part.text,
              summary: part.summary,
              model: part.model,
              encryptedContent: part.encryptedContent,
            }),
          });
          break;
        case "tool_call": {
          const approval = approvalFor(part.id, chat);
          const call: ToolCallPart = {
            type: "tool-call",
            id: part.id,
            name: part.name,
            arguments: part.arguments,
            // Complete arguments must survive interrupt resume. Fresh runs filter abandoned calls themselves.
            state: part.incomplete
              ? "input-streaming"
              : answered.has(part.id)
                ? "complete"
                : approval
                  ? "approval-requested"
                  : "input-complete",
            ...(approval ? { approval } : {}),
          };
          next.parts.push(call);
          owners.set(part.id, next);
          break;
        }
        case "tool_result": {
          const owner = owners.get(part.id);
          // Wingman persisted tool outputs as user turns; natively they belong to the call. An orphan has nowhere to go.
          if (!owner) break;
          const error = message.error ?? undefined;
          const output = result(part.result);
          const data: ToolResultMetadata = defined({ result: output, meta: part.meta, content: part.content, error });
          owner.parts.push({
            type: "tool-result",
            toolCallId: part.id,
            content: describeToolOutput(output),
            state: error ? "error" : "complete",
            ...(error ? { error: error.message } : {}),
            metadata: data as Record<string, unknown>,
          });
          break;
        }
        case "subagent": {
          const routing = readSignature<Record<string, unknown>>(part.signature) ?? {};
          next.parts.push({
            type: "subagent",
            subagent: defined({
              ...routing,
              id: part.id,
              name: part.name,
              description: part.description,
              parentRunId: part.runId,
              parentToolCallId: part.toolCallId,
              status: part.status,
              error: part.error ?? undefined,
              messages: migrateLegacyMessages(part.messages, chat, part.id),
            }) as SubagentPart["subagent"],
          });
          break;
        }
      }
    }
    // A moved tool result leaves an empty user turn behind; a failed assistant turn keeps its error.
    if (next.parts.length || metadata.error) native.push(next);
  });
  return native;
}

// ── Runtime state ──────────────────────────────────────────────────────────

function migrateResume(chat: LegacyStoredChat): Chat["resume"] {
  const run = chat.pendingRun;
  if (!run?.interrupts.length) return undefined;
  return {
    resumeState: { threadId: readSignature<{ threadId: string }>(run.signature)?.threadId ?? chat.id, runId: run.id },
    pendingInterrupts: run.interrupts.map(({ subagentId, schema, metadata, signature, ...interrupt }) => {
      const merged = { ...metadata, ...readSignature<Record<string, unknown>>(signature) };
      return defined({
        ...interrupt,
        subagentRunId: subagentId,
        responseSchema: schema,
        metadata: Object.keys(merged).length ? merged : undefined,
      });
    }),
  };
}

const COMPACTION_NAMESPACE = "@tanstack/ai-compaction";

function migrateMetadata(chat: LegacyStoredChat): Chat["metadata"] {
  const entries = (chat.compactions ?? []).flatMap((compaction) => {
    const checkpoint = readSignature<unknown>(compaction.signature);
    const key = compaction.subagentId ? `${chat.id}/${compaction.subagentId}` : chat.id;
    return checkpoint ? [[key, checkpoint] as const] : [];
  });
  return entries.length ? { [COMPACTION_NAMESPACE]: Object.fromEntries(entries) } : undefined;
}

export function migrateLegacyChat(chat: LegacyStoredChat): StoredChat {
  const resume = migrateResume(chat);
  const metadata = migrateMetadata(chat);
  return {
    version: STORED_CHAT_VERSION,
    id: chat.id,
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    created: chat.created,
    updated: chat.updated,
    model: chat.model,
    messages: migrateLegacyMessages(chat.messages, chat),
    ...(resume ? { resume } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** Whatever shape is on disk, as the current record. */
export function normalizeStoredChat(stored: StoredChat | LegacyStoredChat): StoredChat {
  return isLegacyStoredChat(stored) ? migrateLegacyChat(stored) : stored;
}
