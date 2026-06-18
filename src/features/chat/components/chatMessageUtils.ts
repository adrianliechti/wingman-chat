import { tryParseToolArguments } from "@/shared/lib/toolArguments";
import type { Message, TextContent, ToolResultContent } from "@/shared/types/chat";

// Artifacts-provider tools that produce/write files (unnamespaced — the
// notebook source tools use a `source_` prefix and a different filesystem).
const ARTIFACT_WRITE_TOOLS = new Set(["create_file", "execute_python_code", "execute_bash_code"]);

// User attachments are uploaded into the artifacts workspace and referenced in
// the sent message by this prose line so the model knows to read them. The UI
// parses it back to render clickable artifact chips instead of the raw text.
const ARTIFACT_REFERENCE_PREFIX = "Attached files (available in the artifacts workspace): ";

/** Build the model-facing reference line for files attached to a message. */
export function formatArtifactReference(paths: string[]): string {
  // Newline-separated, not comma: filenames may contain commas (e.g.
  // "clip (1080p, h264).mp4") but never newlines, so this round-trips cleanly.
  return `${ARTIFACT_REFERENCE_PREFIX}${paths.join("\n")}`;
}

/** Extract artifact paths from a reference line, or [] if it isn't one. */
export function parseArtifactReference(text: string): string[] {
  if (!text.startsWith(ARTIFACT_REFERENCE_PREFIX)) return [];
  return text
    .slice(ARTIFACT_REFERENCE_PREFIX.length)
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

function parsePathFromJson(raw: string | undefined): string | null {
  const obj = tryParseToolArguments(raw);
  return obj && typeof obj.path === "string" ? obj.path : null;
}

/** Artifact file paths a single tool result wrote, if any. */
function toolResultArtifactPaths(result: ToolResultContent): string[] {
  if (result.name === "create_file") {
    const resultText = result.result?.find((c): c is TextContent => c.type === "text");
    const path = parsePathFromJson(resultText?.text) ?? parsePathFromJson(result.arguments);
    return path ? [path] : [];
  }
  // execute_python_code / execute_bash_code report written files via meta.
  const files = result.meta?.artifactFiles;
  return Array.isArray(files) ? files.filter((p): p is string => typeof p === "string") : [];
}

/** Whether a message is a genuine user prompt (not a tool-result carrier). */
function isUserPrompt(message: Message): boolean {
  return message.role === "user" && message.content.some((c) => c.type !== "tool_result");
}

/**
 * Collect the artifact files written during the assistant turn ending at
 * `assistantIndex` — gathered from every tool result since the preceding user
 * prompt. Deduplicated, in first-seen order. Used to show the created files as
 * chips on the assistant's completion message.
 */
export function collectTurnArtifactPaths(messages: Message[], assistantIndex: number): string[] {
  let start = 0;
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (isUserPrompt(messages[i])) {
      start = i + 1;
      break;
    }
  }

  const seen = new Set<string>();
  for (let i = start; i <= assistantIndex; i++) {
    for (const part of messages[i]?.content ?? []) {
      if (part.type !== "tool_result") continue;
      if (!ARTIFACT_WRITE_TOOLS.has(part.name)) continue;
      for (const path of toolResultArtifactPaths(part)) seen.add(path);
    }
  }
  return [...seen];
}

// Skill-builder tools that create or modify skills.
const SKILL_WRITE_TOOLS = new Set(["create_skill", "update_skill"]);

/** Skill name from a skill tool result, or null. */
function toolResultSkillName(result: ToolResultContent): string | null {
  const resultText = result.result?.find((c): c is TextContent => c.type === "text");
  if (resultText?.text) {
    try {
      const obj = JSON.parse(resultText.text);
      if (typeof obj?.skill?.name === "string") return obj.skill.name;
    } catch {
      // fall through
    }
  }
  // Fallback: read from arguments
  try {
    const args = JSON.parse(result.arguments ?? "{}");
    if (typeof args?.name === "string") return args.name;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Collect skill names written/updated during the assistant turn ending at
 * `assistantIndex`. Deduplicated, in first-seen order.
 */
export function collectTurnSkillNames(messages: Message[], assistantIndex: number): string[] {
  let start = 0;
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (isUserPrompt(messages[i])) {
      start = i + 1;
      break;
    }
  }

  const seen = new Set<string>();
  for (let i = start; i <= assistantIndex; i++) {
    for (const part of messages[i]?.content ?? []) {
      if (part.type !== "tool_result") continue;
      if (!SKILL_WRITE_TOOLS.has(part.name)) continue;
      const name = toolResultSkillName(part);
      if (name) seen.add(name);
    }
  }
  return [...seen];
}

/** Whether the assistant message at `index` ends a turn (next is a new prompt). */
export function isTurnEnd(messages: Message[], index: number): boolean {
  const next = messages[index + 1];
  return !next || isUserPrompt(next);
}

// ── Tool-call grouping ──────────────────────────────────────────────────────
// A tool-heavy turn produces many adjacent rows (one committed tool result per
// message, plus null-rendering assistant tool-call messages between them). To
// keep the transcript from looking scattered we fold consecutive plain tool
// results into a single collapsible "Used N tools" group. Rich results — MCP
// apps, inline media, errors — stay standalone so nothing important is buried.

function messageHasText(message: Message): boolean {
  return message.content.some((p) => p.type === "text" && p.text);
}

function messageHasMedia(message: Message): boolean {
  return message.content.some((p) => p.type === "image" || p.type === "file" || p.type === "audio");
}

/** A user message that renders as a collapsed tool-result row (see ChatMessage). */
function isToolResultMessage(message: Message): boolean {
  return (
    message.role === "user" &&
    message.content.some((p) => p.type === "tool_result") &&
    !messageHasText(message) &&
    !messageHasMedia(message)
  );
}

/** Tool results that must stay visible standalone (interactive/rich), never folded. */
function isRichToolResultMessage(message: Message): boolean {
  if (message.error) return true;
  for (const part of message.content) {
    if (part.type !== "tool_result") continue;
    // MCP UI app — the app itself is the primary renderer.
    if (typeof part.meta?.toolProvider === "string" && typeof part.meta?.toolResource === "string") return true;
    // Inline media (images/audio/files) is worth keeping in view.
    if (part.result?.some((c) => c.type === "image" || c.type === "audio" || c.type === "file")) return true;
  }
  return false;
}

/** A plain tool result eligible to be folded into a group. */
function isGroupableToolResultMessage(message: Message): boolean {
  return isToolResultMessage(message) && !isRichToolResultMessage(message);
}

/**
 * Assistant message carrying only tool calls (no text/media/reasoning). These
 * render nothing once committed, so they're transparent "connectors" that keep a
 * run of tool results contiguous. A connector with reasoning is excluded so the
 * thought stays visible (and naturally splits the group around it).
 */
function isToolConnectorMessage(message: Message): boolean {
  if (message.role !== "assistant" || message.content.length === 0) return false;
  const hasToolCalls = message.content.some((p) => p.type === "tool_call");
  const hasReasoning = message.content.some((p) => p.type === "reasoning" && (p.text || p.summary));
  return hasToolCalls && !hasReasoning && !messageHasText(message) && !messageHasMedia(message);
}

export type RenderUnit = { kind: "message"; index: number } | { kind: "toolGroup"; indices: number[] };

/**
 * Partition messages into render units: standalone messages and folded tool
 * groups. A group is a maximal run of groupable tool results (plus connectors)
 * with at least two results. While responding, the live final message is never
 * folded so its running indicators stay visible.
 */
export function groupRenderUnits(messages: Message[], isResponding: boolean): RenderUnit[] {
  const units: RenderUnit[] = [];
  const limit = isResponding ? messages.length - 1 : messages.length;

  let i = 0;
  while (i < limit) {
    if (isGroupableToolResultMessage(messages[i]) || isToolConnectorMessage(messages[i])) {
      let j = i;
      const indices: number[] = [];
      while (j < limit && (isGroupableToolResultMessage(messages[j]) || isToolConnectorMessage(messages[j]))) {
        if (isGroupableToolResultMessage(messages[j])) indices.push(j);
        j++;
      }
      if (indices.length >= 2) {
        units.push({ kind: "toolGroup", indices });
      } else {
        for (let k = i; k < j; k++) units.push({ kind: "message", index: k });
      }
      i = j;
    } else {
      units.push({ kind: "message", index: i });
      i++;
    }
  }
  for (; i < messages.length; i++) units.push({ kind: "message", index: i });
  return units;
}

// Helper function to extract and format common parameters for tool calls
export function getToolCallPreview(_toolName: string, arguments_: string): string | null {
  const args = tryParseToolArguments(arguments_);
  if (!args) return null;

  // Common parameter names to look for (in order of preference)
  // Prioritize short, descriptive fields over potentially long content
  const commonParams = [
    // Identification (short & descriptive)
    "title",
    "name",
    "label",
    // Location (usually short)
    "city",
    "location",
    "place",
    // Web & Network (usually concise)
    "url",
    "link",
    "uri",
    "endpoint",
    "address",
    // Files & Paths (usually concise)
    "filename",
    "file",
    "path",
    "filepath",
    "folder",
    "directory",
    // Communication (usually short)
    "subject",
    "email",
    "recipient",
    "to",
    // Commands (usually short)
    "command",
    // Search & Query (can vary in length, but often short)
    "query",
    "search",
    "keyword",
    "q",
    "search_query",
    "term",
    // Short inputs
    "question",
    "input",
    "value",
    // Potentially long content (last resort)
    "message",
    "prompt",
    "instruction",
    "text",
    "content",
    "body",
    "data",
  ];

  // Path-type params are shown workspace-relative — drop any leading slash.
  const pathParams = new Set(["filename", "file", "path", "filepath", "folder", "directory"]);

  // Find the first matching parameter
  for (const param of commonParams) {
    const value = args[param];
    if (value && typeof value === "string") {
      return pathParams.has(param) ? value.replace(/^\/+/, "") : value;
    }
  }

  return null;
}
