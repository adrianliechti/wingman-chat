import type {
  AudioPart,
  ContentPart,
  DocumentPart,
  ImagePart,
  MessagePart,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  UIMessage,
  VideoPart,
} from "@tanstack/ai";
import type { MessageError, MessageUsage } from "../types/chat";

/*
 * Native TanStack messages are the only transcript. App data rides in the
 * `metadata` records TanStack reserves for it: on a message, the run that
 * produced it, its usage, and the failure that ended it; on a tool-result part,
 * the rich result the provider never sees. Nothing here is a second format.
 */

/** App data on a message. */
export interface MessageMetadata {
  runId?: string;
  usage?: MessageUsage;
  /** The failure that ended this turn. */
  error?: MessageError;
  /** A whole-message marker: a compaction summary, or internal feedback the UI hides. */
  kind?: "summary" | "runtime_feedback";
  /** Gateway output phases of this assistant turn, in order. */
  textSegments?: TextSegment[];
}

export interface TextSegment {
  content: string;
  phase?: "commentary" | "final_answer";
}

/** App data on a tool-result part: what the tool produced, beyond the text the model received. */
export interface ToolResultMetadata {
  /** Rich output (text, images, audio, files) shown to the user. */
  result?: ContentPart[];
  /** Tool-owned display and policy data (artifact deltas, status, MCP app bindings). */
  meta?: Record<string, unknown>;
  /** Structured content an MCP app renders. */
  content?: Record<string, unknown>;
  error?: MessageError;
}

export interface ArtifactRef {
  path: string;
  revision?: string;
  displayName?: string;
  jobId?: string;
}

export interface ArtifactSelection {
  path: string;
  text: string;
  /** 1-based, inclusive; omitted when the passage could not be located in the source. */
  startLine?: number;
  endLine?: number;
}

/** App data on a text part. */
export interface TextMetadata {
  phase?: TextSegment["phase"];
  /** The part is a workspace file reference, shown as a chip. */
  artifactRef?: ArtifactRef;
  /** The part is a passage the user highlighted in an artifact. */
  artifactSelection?: ArtifactSelection;
  /** Where internal feedback came from. */
  source?: "verification" | "guardrail";
}

export type MediaPart = ImagePart | AudioPart | VideoPart | DocumentPart;

export interface MediaMetadata {
  filename?: string;
  contentType?: string;
}

export function messageMetadata(message: Pick<UIMessage, "metadata">): MessageMetadata {
  return (message.metadata ?? {}) as MessageMetadata;
}

export function toolResultMetadata(part: ToolResultPart): ToolResultMetadata {
  return (part.metadata ?? {}) as ToolResultMetadata;
}

/** App tools attach rich output; native middleware tools keep their output in content. */
export function toolResultContent(part: ToolResultPart): ContentPart[] {
  return toolResultMetadata(part).result ?? (typeof part.content === "string" ? [text(part.content)] : part.content);
}

export function textMetadata(part: TextPart): TextMetadata {
  return (part.metadata ?? {}) as TextMetadata;
}

export function mediaMetadata(part: MediaPart): MediaMetadata {
  return (part.metadata ?? {}) as MediaMetadata;
}

// ── Constructors ───────────────────────────────────────────────────────────

export function text(content: string, metadata?: TextMetadata): TextPart {
  return metadata ? { type: "text", content, metadata } : { type: "text", content };
}

/** The model reads a workspace reference as prose on its own line; the UI shows a chip. */
export function artifactRefPart(ref: ArtifactRef): TextPart {
  return text(`\nWorkspace file: ${ref.path}`, { artifactRef: ref });
}

/**
 * The model reads a highlighted passage with its location and a fence no
 * backtick run inside the text can close early; the UI shows a quote.
 */
export function artifactSelectionPart(selection: ArtifactSelection): TextPart {
  const body = selection.text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const location = selection.startLine
    ? selection.endLine && selection.endLine !== selection.startLine
      ? ` (lines ${selection.startLine}-${selection.endLine})`
      : ` (line ${selection.startLine})`
    : "";
  // Adjacent text parts collapse into one provider string, so the passage starts on its own line.
  return text(`\nSelected text in ${selection.path}${location}:\n${fence}\n${body}\n${fence}`, {
    artifactSelection: selection,
  });
}

function message(
  role: UIMessage["role"],
  parts: MessagePart[] | string,
  init: Partial<Omit<UIMessage, "role" | "parts">> = {},
): UIMessage {
  return {
    id: init.id ?? crypto.randomUUID(),
    role,
    parts: typeof parts === "string" ? [text(parts)] : parts,
    createdAt: init.createdAt ?? new Date(),
    ...(init.metadata ? { metadata: init.metadata } : {}),
  };
}

export function userMessage(parts: MessagePart[] | string, init?: Partial<Omit<UIMessage, "role" | "parts">>) {
  return message("user", parts, init);
}

export function assistantMessage(parts: MessagePart[] | string, init?: Partial<Omit<UIMessage, "role" | "parts">>) {
  return message("assistant", parts, init);
}

/** A completed tool round the realtime path or an external caller hands to the transcript. */
export function toolRoundMessage(
  call: { id: string; name: string; arguments: string },
  output: ContentPart[],
  init?: Partial<Omit<UIMessage, "role" | "parts">>,
): UIMessage {
  return assistantMessage(
    [
      { type: "tool-call", id: call.id, name: call.name, arguments: call.arguments, state: "complete" },
      {
        type: "tool-result",
        toolCallId: call.id,
        content: describeToolOutput(output),
        state: "complete",
        metadata: { result: output } satisfies ToolResultMetadata,
      },
    ],
    init,
  );
}

// ── Readers ────────────────────────────────────────────────────────────────

/** A human turn: a user message that is not internal feedback. */
export function isUserPrompt(message: Pick<ModelMessage | UIMessage, "role" | "metadata">): boolean {
  return message.role === "user" && message.metadata?.kind !== "runtime_feedback";
}

export function textParts(message: UIMessage): TextPart[] {
  return message.parts.filter((part): part is TextPart => part.type === "text");
}

/** Every text part joined; chips and selections included, as the model reads them. */
export function messageText(message: UIMessage): string {
  return textParts(message)
    .map((part) => part.content)
    .join("");
}

/** What the user typed: the text parts that are not references or selections. */
export function promptText(message: UIMessage): string {
  return textParts(message)
    .filter((part) => !textMetadata(part).artifactRef && !textMetadata(part).artifactSelection)
    .map((part) => part.content)
    .join("");
}

/** Output phases of an assistant turn: the gateway's segments when present, else its text parts. */
export function textSegments(message: UIMessage): TextSegment[] {
  const segments = messageMetadata(message).textSegments;
  if (segments?.length) return segments;
  return textParts(message).map((part) => ({ content: part.content, phase: textMetadata(part).phase }));
}

/** Prefer the last explicit final answer, or the last unphased segment from older providers. */
export function finalText(message: UIMessage): string {
  const segments = textSegments(message);
  return (
    (segments.findLast((segment) => segment.phase === "final_answer") ?? segments.findLast((segment) => !segment.phase))
      ?.content ?? ""
  );
}

export function toolCalls(message: UIMessage): ToolCallPart[] {
  return message.parts.filter((part): part is ToolCallPart => part.type === "tool-call");
}

export function toolResults(message: UIMessage): ToolResultPart[] {
  return message.parts.filter((part): part is ToolResultPart => part.type === "tool-result");
}

export function toolResultFor(message: UIMessage, toolCallId: string): ToolResultPart | undefined {
  return toolResults(message).find((part) => part.toolCallId === toolCallId);
}

export function isMediaPart(part: MessagePart): part is MediaPart {
  return part.type === "image" || part.type === "audio" || part.type === "video" || part.type === "document";
}

// ── Media ──────────────────────────────────────────────────────────────────

const DATA_URL = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/;

/** A media part from a data URL; the kind follows the MIME type unless given. */
export function mediaFromDataUrl(dataUrl: string, name?: string, kind?: MediaPart["type"]): MediaPart {
  const match = DATA_URL.exec(dataUrl);
  const mimeType = match?.[1] ?? "application/octet-stream";
  const type = kind ?? mediaKind(mimeType);
  return {
    type,
    source: match ? { type: "data", value: match[2], mimeType } : { type: "url", value: dataUrl },
    metadata: { ...(name ? { filename: name } : {}), contentType: mimeType } satisfies MediaMetadata,
  } as MediaPart;
}

function mediaKind(mimeType: string): MediaPart["type"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export function mediaMimeType(part: MediaPart): string | undefined {
  return (
    mediaMetadata(part).contentType ??
    (part.source.type === "data" ? part.source.mimeType : undefined) ??
    (part.source.type === "url" ? DATA_URL.exec(part.source.value)?.[1] : undefined)
  );
}

export function mediaName(part: MediaPart): string | undefined {
  return mediaMetadata(part).filename;
}

/** The part's bytes as a data URL, or its URL; undefined for provider file handles. */
export function mediaDataUrl(part: MediaPart): string | undefined {
  if (part.source.type === "data")
    return `data:${mediaMimeType(part) ?? "application/octet-stream"};base64,${part.source.value}`;
  if (part.source.type === "url") return part.source.value;
  return undefined;
}

/** The text the model receives for a tool's output; media is described, not sent. */
export function describeToolOutput(output: readonly ContentPart[]): string {
  return output
    .map((part) => {
      if (part.type === "text") return part.content;
      const name = mediaName(part);
      if (part.type === "image") return `[Image${name ? `: ${name}` : ""} - displayed to user]`;
      if (part.type === "audio") return `[Audio${name ? `: ${name}` : ""} - displayed to user]`;
      if (part.type === "video") return `[Video${name ? `: ${name}` : ""} - displayed to user]`;
      return `[File: ${name ?? "attachment"} - displayed to user]`;
    })
    .filter(Boolean)
    .join("\n");
}

/** The text of a tool's rich output, for display hooks and tool-reading callers. */
export function outputText(output: readonly ContentPart[]): string {
  return output
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

// ── Transforms ─────────────────────────────────────────────────────────────

/** Apply `update` to every message, recursing into subagent conversations. */
export function mapMessages(messages: UIMessage[], update: (message: UIMessage) => UIMessage): UIMessage[] {
  return messages.map((message) => {
    const parts = message.parts.map((part) =>
      part.type === "subagent"
        ? { ...part, subagent: { ...part.subagent, messages: mapMessages(part.subagent.messages, update) } }
        : part,
    );
    return update(parts.some((part, index) => part !== message.parts[index]) ? { ...message, parts } : message);
  });
}

/** Replace one tool's metadata without mutating earlier history snapshots. */
export function updateToolResultMeta(messages: UIMessage[], toolCallId: string, meta: Record<string, unknown>) {
  return mapMessages(messages, (message) => {
    const parts = message.parts.map((part) =>
      part.type === "tool-result" && part.toolCallId === toolCallId
        ? { ...part, metadata: { ...part.metadata, meta: { ...meta } } }
        : part,
    );
    return parts.some((part, index) => part !== message.parts[index]) ? { ...message, parts } : message;
  });
}
