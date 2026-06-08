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
  return `${ARTIFACT_REFERENCE_PREFIX}${paths.join(", ")}`;
}

/** Extract artifact paths from a reference line, or [] if it isn't one. */
export function parseArtifactReference(text: string): string[] {
  if (!text.startsWith(ARTIFACT_REFERENCE_PREFIX)) return [];
  return text
    .slice(ARTIFACT_REFERENCE_PREFIX.length)
    .split(",")
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

  // Find the first matching parameter
  for (const param of commonParams) {
    const value = args[param];
    if (value && typeof value === "string") {
      return value;
    }
  }

  return null;
}
