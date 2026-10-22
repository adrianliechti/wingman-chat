/**
 * One-way migration of chats saved before the native transcript (stored
 * record version 2). The old record kept Wingman's own `Message[]` with tool
 * outputs as user turns and runtime state in opaque `@tanstack:` signatures.
 * The result is deterministic, so a chat that is loaded but never saved again
 * migrates to the same record each time.
 *
 * The migration never throws for a malformed record. A part, message, or
 * runtime section it cannot read is dropped with a console warning so the
 * rest of the conversation still opens; the caller keeps the original file
 * next to the first native save so nothing dropped here is lost for good.
 */

import {
  isContentPart,
  isContentPartArray,
  readInterruptBinding,
  type MessagePart,
  type SubagentPart,
  type ToolCallPart,
  type ToolResultPart,
  type UIMessage,
  type UIResourcePart,
} from "@tanstack/ai";
import type { Chat, MessageError, MessageUsage, Model } from "@/shared/types/chat";
import {
  artifactRefPart,
  artifactSelectionPart,
  isMediaPart,
  mapMessages,
  mediaFromDataUrl,
  messageText,
  outputText,
  text,
  toolResultContent,
  uiResourceFor,
  withTextPhases,
  type ArtifactRef,
  type ArtifactSelection,
  type MediaPart,
  type MessageMetadata,
  type TextMetadata,
  type TextPhase,
} from "./messages";
import { STORED_CHAT_VERSION, type StoredChat } from "./opfs-chat";
import { parseBlobRef } from "./opfs-core";
import { packGatewayReasoning } from "./reasoning";
import { artifactDelta, artifactDeltaFromMeta } from "../types/artifact";
import { toolArgumentPath, tryParseToolArguments } from "./toolArguments";

// ── The old record ─────────────────────────────────────────────────────────

type LegacyMedia = { type: "image" | "audio" | "file"; name?: string; data: string; contentType?: string };
type LegacyText = { type: "text"; text: string; phase?: TextPhase };
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

/** The old record never carried a version. A record with an unknown version is left alone rather than guessed at. */
export function isLegacyStoredChat(stored: { version?: unknown; messages?: unknown[] }): stored is LegacyStoredChat {
  return stored.version === undefined;
}

/** Keep references in every JSON field, including parts too damaged or unfamiliar to migrate. */
export function collectLegacyChatBlobIds(stored: unknown): string[] {
  const ids = new Set<string>();
  const pending = [stored];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      const id = parseBlobRef(value);
      if (id) ids.add(id);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) pending.push(item);
    }
  }
  return [...ids];
}

function warn(scope: string, what: string, detail?: unknown): void {
  console.warn(`Chat migration (${scope}): ${what}`, ...(detail === undefined ? [] : [detail]));
}

/** Run one migration stage; a stage that throws yields its fallback instead of failing the whole chat. */
function stage<T>(scope: string, what: string, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    warn(scope, `dropped ${what}`, error);
    return fallback;
  }
}

/** A parseable date, or the fallback. An invalid date would open fine and then fail every save. */
function validDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function requireText(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("part without readable text");
  return value;
}

function media(part: LegacyMedia): MediaPart {
  if (typeof part.data !== "string") throw new TypeError(`${part.type} part without data`);
  const kind = part.type === "file" ? "document" : part.type;
  if (part.data.startsWith("data:")) return mediaFromDataUrl(part.data, part.name, kind);
  // A blob reference or external URL stays a reference; the stored type is kept for rehydration.
  return {
    type: kind,
    source: defined({ type: "url", value: part.data, mimeType: part.contentType }),
    ...(part.name ? { metadata: { filename: part.name } } : {}),
  } as MediaPart;
}

function result(parts: LegacyToolResult["result"]) {
  if (!Array.isArray(parts)) throw new TypeError("tool result without output parts");
  return parts.map((part) => (part.type === "text" ? text(requireText(part.text)) : media(part)));
}

/** Pending approvals keep their native tool-call state so the interrupt card can resume them. */
function approvalFor(toolCallId: string, chat: LegacyStoredChat) {
  const interrupts = Array.isArray(chat.pendingRun?.interrupts) ? chat.pendingRun.interrupts : [];
  const interrupt = interrupts.find(
    (item) => item?.toolCallId === toolCallId && (item.reason === "tool_call" || item.reason === "approval_required"),
  );
  return interrupt ? { id: interrupt.id, needsApproval: true } : undefined;
}

function isLegacyMessage(message: unknown): message is LegacyMessage {
  return (
    !!message &&
    typeof message === "object" &&
    ((message as LegacyMessage).role === "user" || (message as LegacyMessage).role === "assistant") &&
    Array.isArray((message as LegacyMessage).content)
  );
}

export function migrateLegacyMessages(messages: LegacyMessage[], chat: LegacyStoredChat, scope = chat.id): UIMessage[] {
  if (!Array.isArray(messages)) {
    warn(scope, "dropped messages that are not a list");
    return [];
  }
  const answered = new Set(
    messages.flatMap((message) =>
      isLegacyMessage(message)
        ? message.content.flatMap((part) => (part?.type === "tool_result" ? [part.id] : []))
        : [],
    ),
  );
  const fallbackCreatedAt = validDate(chat.created, new Date(0));
  const native: UIMessage[] = [];
  const owners = new Map<string, UIMessage>();

  messages.forEach((message, index) => {
    if (!isLegacyMessage(message)) {
      warn(scope, `dropped message ${index}: not a user or assistant message with content`);
      return;
    }
    const kinds = new Set(message.content.map((part) => part?.type));
    const kind: MessageMetadata["kind"] | undefined =
      kinds.size === 1 && kinds.has("summary")
        ? "summary"
        : kinds.size === 1 && kinds.has("runtime_feedback")
          ? "runtime_feedback"
          : undefined;
    const metadata: MessageMetadata = defined({
      runId: message.runId,
      usage: message.usage,
      error: message.role === "assistant" ? (message.error ?? undefined) : undefined,
      kind,
    });
    const next: UIMessage = {
      id: message.id ?? `legacy-${scope}-${index}`,
      role: message.role,
      parts: [],
      createdAt: validDate(message.createdAt, fallbackCreatedAt),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };

    // Each part migrates on its own: one unreadable part costs that part, not the conversation.
    message.content.forEach((part, partIndex) => {
      try {
        migratePart(part);
      } catch (error) {
        warn(scope, `dropped ${part?.type ?? "unknown"} part ${partIndex} of message ${next.id}`, error);
      }
    });
    // A moved tool result leaves an empty user turn behind; a failed assistant turn keeps its error.
    if (next.parts.length || metadata.error) native.push(next);

    function migratePart(part: LegacyContent): void {
      switch (part.type) {
        case "text": {
          const textMetadata: TextMetadata = defined({ phase: part.phase });
          next.parts.push(text(requireText(part.text), Object.keys(textMetadata).length ? textMetadata : undefined));
          break;
        }
        case "summary":
          next.parts.push(text(requireText(part.text)));
          break;
        case "runtime_feedback":
          next.parts.push(text(requireText(part.text), { source: part.source }));
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
            content: requireText(part.summary ?? part.text),
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
          owner.parts.push(
            normalizeToolResult({
              type: "tool-result",
              toolCallId: part.id,
              content: output,
              state: error ? "error" : "complete",
              ...(error ? { error: error.message } : {}),
              metadata: defined({ meta: part.meta, content: part.content }),
            }),
          );
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
        default:
          throw new TypeError(`unknown part type ${JSON.stringify((part as { type?: unknown })?.type)}`);
      }
    }
  });
  return native.map(normalizeAppParts);
}

// ── Runtime state ──────────────────────────────────────────────────────────

function migrateResume(chat: LegacyStoredChat): Chat["resume"] {
  const run = chat.pendingRun;
  if (!Array.isArray(run?.interrupts) || !run.interrupts.length) return undefined;
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
  const entries = (Array.isArray(chat.compactions) ? chat.compactions : []).flatMap((compaction) => {
    const checkpoint = readSignature<unknown>(compaction.signature);
    const key = compaction.subagentId ? `${chat.id}/${compaction.subagentId}` : chat.id;
    return checkpoint ? [[key, checkpoint] as const] : [];
  });
  return entries.length ? { [COMPACTION_NAMESPACE]: Object.fromEntries(entries) } : undefined;
}

export function migrateLegacyChat(chat: LegacyStoredChat): StoredChat {
  const resume = stage(chat.id, "the pending run", () => migrateResume(chat), undefined);
  const metadata = stage(chat.id, "the compaction checkpoints", () => migrateMetadata(chat), undefined);
  const created = validIsoDate(chat.created);
  const updated = validIsoDate(chat.updated);
  if (chat.created && !created) warn(chat.id, `ignored unreadable created date ${JSON.stringify(chat.created)}`);
  if (chat.updated && !updated) warn(chat.id, `ignored unreadable updated date ${JSON.stringify(chat.updated)}`);
  return {
    version: STORED_CHAT_VERSION,
    id: chat.id,
    title: typeof chat.title === "string" ? chat.title : undefined,
    customTitle: typeof chat.customTitle === "string" ? chat.customTitle : undefined,
    customIndex: typeof chat.customIndex === "number" ? chat.customIndex : undefined,
    created,
    updated: updated ?? created,
    model: chat.model && typeof chat.model === "object" ? chat.model : null,
    messages: migrateLegacyMessages(chat.messages, chat),
    ...(resume ? { resume } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Move legacy output/error onto native fields and keep only one copy of app data. */
function normalizeToolResult(part: ToolResultPart, call?: ToolCallPart): ToolResultPart {
  const metadata = { ...part.metadata };
  const next = { ...part };
  let changed = false;
  const rich = metadata.result;
  if (Array.isArray(rich)) {
    const readable = rich.filter(isContentPart);
    if (readable.length || !rich.length) next.content = readable;
    if (readable.length !== rich.length) warn(part.toolCallId, "dropped unreadable tool output parts");
    delete metadata.result;
    changed = true;
  }
  const error = metadata.error;
  if (isRecord(error) && typeof error.message === "string") {
    next.state = "error";
    next.error ??= error.message;
    delete metadata.error;
    changed = true;
  }

  if (isRecord(metadata.meta)) {
    const meta = { ...metadata.meta };
    if (Array.isArray(meta.artifactFiles)) {
      if (!artifactDeltaFromMeta(meta)) {
        meta.artifactDelta = artifactDelta(
          meta.artifactFiles
            .filter((path): path is string => typeof path === "string" && path.length > 0)
            .map((path) => ({ operation: "create", path })),
        );
      }
      delete meta.artifactFiles;
      changed = true;
    }
    if ("status" in meta) {
      delete meta.status;
      changed = true;
    }
    if ("defaultDisplayMode" in meta) {
      meta.appDisplayMode ??= meta.defaultDisplayMode;
      delete meta.defaultDisplayMode;
      changed = true;
    }
    if ("appDisplayModes" in meta) {
      delete meta.appDisplayModes;
      changed = true;
    }
    // A full original response wins over its old structured-content duplicate.
    // Old app results without that response get a partial envelope; content is
    // reconstructed from hydrated native parts when the app is opened.
    if (isRecord(metadata.content) && (typeof meta.toolResource === "string" || isRecord(meta.mcpResult))) {
      const original = isRecord(meta.mcpResult) ? meta.mcpResult : {};
      if (original.structuredContent === undefined) {
        meta.mcpResult = { ...original, structuredContent: metadata.content };
      }
    }
    if (isRecord(meta.mcpResult) && meta.mcpResult.isError === true && next.state !== "error") {
      next.state = "error";
      next.error ??= outputText(toolResultContent(next)) || "MCP tool returned an error";
      changed = true;
    }
    if (Object.keys(meta).length) metadata.meta = meta;
    else delete metadata.meta;
  }
  // Older create calls reported only their path. Convert that once rather than
  // infer file writes from arguments in the renderer of every current turn.
  if (
    next.state !== "error" &&
    call &&
    ["create", "artifacts_create", "create_file"].includes(call.name) &&
    !artifactDeltaFromMeta(metadata.meta as Record<string, unknown> | undefined)
  ) {
    const path =
      toolArgumentPath(tryParseToolArguments(outputText(toolResultContent(next)))) ??
      toolArgumentPath(tryParseToolArguments(call.arguments));
    if (path) {
      metadata.meta = {
        ...(metadata.meta as Record<string, unknown>),
        artifactDelta: artifactDelta([{ operation: "create", path }]),
      };
      changed = true;
    }
  }
  // Non-app structured copies had no reader. The storage boundary keeps the
  // original record so unreadable output remains available for recovery.
  if ("content" in metadata) {
    delete metadata.content;
    changed = true;
  }
  if (!changed) return part;
  if (Object.keys(metadata).length) next.metadata = metadata;
  else delete next.metadata;
  return next;
}

/** Older app bindings become native parts; their HTML is fetched on first opening. */
function normalizeAppParts(message: UIMessage): UIMessage {
  let changed = false;
  const migrated = new Map<string, UIResourcePart>();
  const parts = message.parts.flatMap((part) => {
    if (part.type !== "tool-result" || !isRecord(part.metadata?.meta)) return [part];
    const meta = part.metadata.meta;
    const existing = uiResourceFor(message, part.toolCallId);
    const provider = typeof meta.toolProvider === "string" ? meta.toolProvider : undefined;
    const uri =
      typeof meta.toolResource === "string" && meta.toolResource.startsWith("ui://") ? meta.toolResource : undefined;
    if (!existing && (!provider || !uri)) return [part];
    if (existing && !provider && !uri && !isRecord(meta.mcpResult) && !("appDisplayMode" in meta)) return [part];
    const call = message.parts.find(
      (item): item is ToolCallPart => item.type === "tool-call" && item.id === part.toolCallId,
    );
    if (!existing && !call) return [part];
    const appMeta = {
      ...(typeof meta.appDisplayMode === "string" ? { appDisplayMode: meta.appDisplayMode } : {}),
      ...(isRecord(meta.mcpResult) ? { mcpResult: meta.mcpResult } : {}),
      ...existing?.meta,
    };
    const app: UIResourcePart = {
      ...(existing ?? {
        type: "ui-resource",
        resource: { uri: uri!, mimeType: "text/html;profile=mcp-app" },
        serverId: provider!,
        toolCallId: part.toolCallId,
        // Historical names may be provider aliases; the MCP client retains them.
        toolName: call!.name,
      }),
      ...(Object.keys(appMeta).length ? { meta: appMeta } : {}),
    };
    const { toolProvider: _provider, toolResource: _resource, appDisplayMode: _mode, ...remaining } = meta;
    if (isRecord(meta.mcpResult)) delete remaining.mcpResult;
    const { meta: _meta, ...metadata } = part.metadata!;
    if (Object.keys(remaining).length) metadata.meta = remaining;
    const { metadata: _metadata, ...result } = part;
    changed = true;
    if (existing) migrated.set(app.toolCallId, app);
    const next = Object.keys(metadata).length ? { ...result, metadata } : result;
    return existing ? [next] : [next, app];
  });
  return changed
    ? {
        ...message,
        parts: parts.map((part) => (part.type === "ui-resource" ? (migrated.get(part.toolCallId) ?? part) : part)),
      }
    : message;
}

/** Move a saved duplicate MIME type onto the native source, including nested tool output. */
function normalizePart(part: MessagePart): MessagePart {
  if (isMediaPart(part) && isRecord(part.metadata) && typeof part.metadata.contentType === "string") {
    const { contentType, ...metadata } = part.metadata;
    const { metadata: _metadata, ...rest } = part;
    return {
      ...rest,
      source: { ...part.source, mimeType: part.source.mimeType ?? contentType },
      ...(Object.keys(metadata).length ? { metadata } : {}),
    } as MediaPart;
  }
  if (part.type === "tool-call" && isContentPartArray(part.output)) {
    const previous = part.output;
    const output = previous.map(normalizePart);
    if (output.some((item, index) => item !== previous[index])) return { ...part, output } as ToolCallPart;
  }
  if (part.type === "tool-result" && Array.isArray(part.content)) {
    const content = part.content.map(normalizePart);
    if (content.some((item, index) => item !== part.content[index])) return { ...part, content } as ToolResultPart;
  }
  return part;
}

/** Whatever shape is on disk, as the current record. */
export function normalizeStoredChat(stored: StoredChat | LegacyStoredChat): StoredChat {
  if (isLegacyStoredChat(stored)) return normalizeStoredChat(migrateLegacyChat(stored));
  if (stored.version !== STORED_CHAT_VERSION) return stored;
  if (stored.resume?.pendingInterrupts?.some((interrupt) => !readInterruptBinding(interrupt))) {
    // A partial batch cannot resume safely. Keep the transcript and let the
    // next message start a fresh run; loadChat preserves the original record.
    warn(stored.id, "cleared a pending run with unsupported interrupt bindings");
    const { resume: _resume, ...rest } = stored;
    stored = rest;
  }
  const messages = mapMessages(stored.messages, (message) => {
    const calls = new Map(
      message.parts.flatMap((part) => (part.type === "tool-call" ? [[part.id, part] as const] : [])),
    );
    const parts = message.parts.map((part) =>
      normalizePart(part.type === "tool-result" ? normalizeToolResult(part, calls.get(part.toolCallId)) : part),
    );
    if (parts.some((part, index) => part !== message.parts[index])) message = { ...message, parts };
    message = normalizeAppParts(message);
    const legacy = message.metadata?.textSegments;
    if (!Array.isArray(legacy)) return message;
    const phased = legacy.flatMap((segment) =>
      segment && typeof segment.content === "string"
        ? [
            text(
              segment.content,
              segment.phase === "commentary" || segment.phase === "final_answer" ? { phase: segment.phase } : undefined,
            ),
          ]
        : [],
    );
    // Keep unfamiliar or damaged metadata intact rather than discard readable text.
    if (messageText(message) !== phased.map((part) => part.content).join("")) return message;
    const next = withTextPhases(message, phased);
    const { textSegments: _legacy, ...metadata } = message.metadata!;
    const { metadata: _metadata, ...rest } = next;
    return Object.keys(metadata).length ? { ...rest, metadata } : rest;
  });
  return messages === stored.messages ? stored : { ...stored, messages };
}
