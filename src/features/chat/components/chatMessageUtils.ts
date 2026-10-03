import type { ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import { tryParseToolArguments } from "@/shared/lib/toolArguments";
import { artifactDeltaFromMeta, updateArtifactPaths } from "@/shared/types/artifact";
import {
  isMediaPart,
  isUserPrompt,
  messageMetadata,
  outputText,
  textMetadata,
  toolResultContent,
  toolResultMetadata,
  toolResults,
} from "@/shared/lib/messages";
import { isMemoryPath } from "@/features/agent/lib/memoryDocument";
import { memoryOperationPaths } from "@/features/agent/lib/memoryFileDisplay";

// Artifacts-provider tools that produce or write files.
const ARTIFACT_WRITE_TOOLS = new Set([
  "artifacts_create",
  "artifacts_edit",
  "artifacts_move",
  "artifacts_delete",
  "create",
  "edit",
  "move",
  "delete",
  "execute_script",
  // Interpreter names retained only for persisted conversations.
  "execute_python_code",
  "execute_javascript_code",
  // Render artifacts from conversations saved before the concise tool rename.
  "create_file",
  "edit_file",
  "move_file",
  "delete_file",
]);

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

// ── Tool rounds ─────────────────────────────────────────────────────────────
// Natively a tool result is anchored to its call inside the same assistant
// message. A "round" pairs them so renderers never have to search.

export interface ToolRound {
  call: ToolCallPart;
  result?: ToolResultPart;
}

/** A delegated call is already represented by its child conversation. */
export function subagentToolCallIds(messages: readonly UIMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "subagent" && part.subagent.parentToolCallId ? [part.subagent.parentToolCallId] : [],
      ),
    ),
  );
}

function isFailedResult(result: ToolResultPart | undefined): boolean {
  return !!result && (result.state === "error" || !!toolResultMetadata(result).error);
}

/**
 * The calls of a message, each with its result when it has one. A delegated
 * call is left out, since its child conversation represents it, unless it
 * failed and the failure would otherwise be invisible.
 */
export function toolRounds(message: UIMessage, delegated?: ReadonlySet<string>): ToolRound[] {
  const results = new Map(toolResults(message).map((part) => [part.toolCallId, part]));
  return message.parts.flatMap((part) => {
    if (part.type !== "tool-call") return [];
    const result = results.get(part.id);
    return delegated?.has(part.id) && !isFailedResult(result) ? [] : [{ call: part, result }];
  });
}

/** Artifact file paths a single tool round wrote, if any. */
function roundArtifactPaths({ call, result }: ToolRound): string[] {
  const meta = result ? toolResultMetadata(result).meta : undefined;
  if (call.name === "artifacts_create" || call.name === "create" || call.name === "create_file") {
    const output = result ? toolResultContent(result) : undefined;
    const path = parsePathFromJson(output ? outputText(output) : undefined) ?? parsePathFromJson(call.arguments);
    return path ? [path] : [];
  }
  // Code execution tools report written files via meta (including historical names).
  const files = meta?.artifactFiles;
  return Array.isArray(files) ? files.filter((p): p is string => typeof p === "string") : [];
}

function turnStart(messages: readonly UIMessage[], assistantIndex: number): number {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (isUserPrompt(messages[i])) return i + 1;
  }
  return 0;
}

/**
 * Collect the artifact files written during the assistant turn ending at
 * `assistantIndex` — gathered from every tool result since the preceding user
 * prompt. Deduplicated, respecting moves and deletions. Shows generated files as
 * chips on the assistant's completion message.
 */
export function collectTurnArtifactPaths(messages: readonly UIMessage[], assistantIndex: number): string[] {
  const seen = new Set<string>();
  for (let i = turnStart(messages, assistantIndex); i <= assistantIndex; i++) {
    const message = messages[i];
    if (!message) continue;
    for (const part of message.parts) {
      if (part.type === "text") {
        const ref = textMetadata(part).artifactRef;
        if (ref) seen.add(ref.path);
      }
    }
    for (const round of toolRounds(message)) {
      const delta = round.result ? artifactDeltaFromMeta(toolResultMetadata(round.result).meta) : null;
      if (delta) {
        updateArtifactPaths(seen, delta.mutations);
        continue;
      }
      if (!round.result || !ARTIFACT_WRITE_TOOLS.has(round.call.name)) continue;
      for (const path of roundArtifactPaths(round)) seen.add(path);
    }
  }
  return [...seen].filter((path) => !isMemoryPath(path));
}

// Skill-builder tools that create or modify skills.
const SKILL_WRITE_TOOLS = new Set(["create_skill", "update_skill"]);

/** Skill name from a skill tool round, or null. */
function roundSkillName({ call, result }: ToolRound): string | null {
  const output = result ? toolResultContent(result) : undefined;
  const resultText = output ? outputText(output) : "";
  if (resultText) {
    try {
      const obj = JSON.parse(resultText);
      if (typeof obj?.skill?.name === "string") return obj.skill.name;
    } catch {
      // fall through
    }
  }
  // Fallback: read from arguments (recovers the name even when a sibling code
  // field left the JSON mis-escaped).
  const args = tryParseToolArguments(call.arguments);
  if (typeof args?.name === "string") return args.name;
  return null;
}

/**
 * Collect skill names written/updated during the assistant turn ending at
 * `assistantIndex`. Deduplicated, in first-seen order.
 */
export function collectTurnSkillNames(messages: readonly UIMessage[], assistantIndex: number): string[] {
  const seen = new Set<string>();
  for (let i = turnStart(messages, assistantIndex); i <= assistantIndex; i++) {
    const message = messages[i];
    if (!message) continue;
    for (const round of toolRounds(message)) {
      if (!round.result || !SKILL_WRITE_TOOLS.has(round.call.name)) continue;
      const name = roundSkillName(round);
      if (name) seen.add(name);
    }
  }
  return [...seen];
}

/** Whether the assistant message at `index` ends a turn (next is a new prompt). */
export function isTurnEnd(messages: readonly UIMessage[], index: number): boolean {
  const next = messages[index + 1];
  return !next || isUserPrompt(next);
}

// ── Tool-call grouping ──────────────────────────────────────────────────────
// A tool-heavy turn produces many adjacent assistant messages that hold only
// tool rounds. To keep the transcript from looking scattered we fold
// consecutive plain tool rounds into a single collapsible "Used N tools" group.
// Rich results — MCP apps, inline media, errors — stay standalone so nothing
// important is buried.

function hasText(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === "text" && part.content);
}

function hasReasoning(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === "thinking" && part.content);
}

function hasMedia(message: UIMessage): boolean {
  return message.parts.some(isMediaPart);
}

/**
 * An assistant message carrying only tool rounds (no text, media, reasoning or
 * subagent). It renders as tool rows, and a run of them folds into a group.
 */
export function isToolOnlyMessage(message: UIMessage): boolean {
  if (message.role !== "assistant" || message.parts.length === 0 || messageMetadata(message).error) return false;
  return (
    message.parts.some((part) => part.type === "tool-call") &&
    !hasText(message) &&
    !hasReasoning(message) &&
    !hasMedia(message) &&
    !message.parts.some((part) => part.type === "subagent" || part.type === "structured-output")
  );
}

/** A result that must stay visible standalone (interactive/rich), never folded. */
export function isRichToolResult(result: ToolResultPart): boolean {
  const data = toolResultMetadata(result);
  if (isFailedResult(result)) return true;
  // MCP UI app — the app itself is the primary renderer.
  if (typeof data.meta?.toolProvider === "string" && typeof data.meta?.toolResource === "string") return true;
  // Inline media (images/audio/files) is worth keeping in view.
  return toolResultContent(result).some(isMediaPart);
}

function hostsToolCall(message: UIMessage, toolCallId?: string | null): boolean {
  if (!toolCallId) return false;
  return message.parts.some((p) => p.type === "tool-call" && p.id === toolCallId);
}

export type RenderUnit = { kind: "message"; index: number } | { kind: "toolGroup"; indices: number[] };

/**
 * Partition messages into standalone messages and folded tool groups (runs of
 * groupable tool-only messages with 2+ results). `pendingElicitationToolCallId`
 * keeps a message hosting an awaiting elicitation prompt standalone.
 */
export function groupRenderUnits(
  messages: readonly UIMessage[],
  isResponding: boolean,
  pendingElicitationToolCallId?: string | null,
): RenderUnit[] {
  const units: RenderUnit[] = [];
  const delegated = subagentToolCallIds(messages);
  const rounds = (message: UIMessage) => toolRounds(message, delegated);
  // Every call is delegated: the child conversation already represents it.
  const represented = (message: UIMessage) => isToolOnlyMessage(message) && rounds(message).length === 0;
  const addMessage = (index: number) => {
    if (!represented(messages[index])) units.push({ kind: "message", index });
  };
  const limit = isResponding ? messages.length - 1 : messages.length;
  const groupable = (message: UIMessage) =>
    isToolOnlyMessage(message) &&
    !hostsToolCall(message, pendingElicitationToolCallId) &&
    rounds(message).every((round) => round.result && !isRichToolResult(round.result));

  let i = 0;
  while (i < limit) {
    if (groupable(messages[i])) {
      let j = i;
      const indices: number[] = [];
      let results = 0;
      while (j < limit && groupable(messages[j])) {
        const count = rounds(messages[j]).length;
        if (count) {
          indices.push(j);
          results += count;
        }
        j++;
      }
      if (results >= 2) {
        units.push({ kind: "toolGroup", indices });
      } else {
        for (let k = i; k < j; k++) addMessage(k);
      }
      i = j;
    } else {
      addMessage(i);
      i++;
    }
  }
  for (; i < messages.length; i++) addMessage(i);
  return units;
}

type ToolFamily = "read" | "search" | "edit" | "run" | "generic";

const TOOL_FAMILIES: Record<string, ToolFamily> = {
  artifacts_read: "read",
  repository_read: "read",
  artifacts_glob: "search",
  artifacts_grep: "search",
  repository_glob: "search",
  repository_grep: "search",
  repository_search: "search",
  artifacts_create: "edit",
  artifacts_edit: "edit",
  artifacts_move: "edit",
  artifacts_delete: "edit",
  read: "read",
  current_file: "read",
  current_selection: "read",
  grep: "search",
  glob: "search",
  web_search: "search",
  search: "search",
  create: "edit",
  edit: "edit",
  move: "edit",
  delete: "edit",
  execute_script: "run",
  // Interpreter names retained only for persisted conversations.
  execute_python_code: "run",
  execute_javascript_code: "run",
  // Historical names can still occur in persisted message content.
  read_file: "read",
  create_file: "edit",
  edit_file: "edit",
  move_file: "edit",
  delete_file: "edit",
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function deltaPaths(result: ToolResultPart | undefined): string[] {
  return result
    ? (artifactDeltaFromMeta(toolResultMetadata(result).meta)?.mutations.map((mutation) => mutation.path) ?? [])
    : [];
}

/** Past-tense semantic summary for a completed group of tool-only messages. */
export function summarizeToolGroup(messages: readonly UIMessage[], indices: number[]): string {
  const readTargets = new Set<string>();
  const editTargets = new Set<string>();
  let searches = 0;
  let runs = 0;
  let generic = 0;
  let total = 0;
  const memoryReads = new Set<string>();
  const memoryWrites = new Set<string>();
  const memoryDeletes = new Set<string>();
  let memorySearches = 0;
  const delegated = subagentToolCallIds(messages);

  for (const index of indices) {
    const message = messages[index];
    if (!message) continue;
    for (const { call, result } of toolRounds(message, delegated)) {
      total++;
      const family = TOOL_FAMILIES[call.name] ?? (call.name.startsWith("execute_") ? "run" : "generic");
      const args = tryParseToolArguments(call.arguments);
      if (args && call.name.startsWith("artifacts_")) {
        const operation = call.name.slice("artifacts_".length);
        const paths = memoryOperationPaths(operation, args).filter(isMemoryPath) as string[];
        if (paths.length) {
          if (operation === "glob" || operation === "grep") memorySearches++;
          else
            for (const path of paths)
              (operation === "read" ? memoryReads : operation === "delete" ? memoryDeletes : memoryWrites).add(path);
          continue;
        }
      }
      const argumentPath =
        typeof args?.file_path === "string"
          ? args.file_path
          : typeof args?.path === "string"
            ? args.path
            : typeof args?.from === "string"
              ? args.from
              : `${call.name}:${call.id}`;

      if (family === "read") readTargets.add(argumentPath);
      else if (family === "edit") {
        const paths = deltaPaths(result);
        if (paths.length > 0) paths.forEach((path) => editTargets.add(path));
        else editTargets.add(argumentPath);
      } else if (family === "search") searches++;
      else if (family === "run") runs++;
      else generic++;
    }
  }

  const segments: string[] = [];
  if (readTargets.size) segments.push(`Read ${plural(readTargets.size, "file")}`);
  if (searches) segments.push(`Ran ${plural(searches, "search", "searches")}`);
  if (editTargets.size) segments.push(`Edited ${plural(editTargets.size, "file")}`);
  if (runs) segments.push(`Ran ${plural(runs, "command")}`);
  if (memoryReads.size) segments.push(`Read ${plural(memoryReads.size, "memory note")}`);
  if (memorySearches) segments.push("Searched memory");
  if (memoryWrites.size) segments.push(`Updated ${plural(memoryWrites.size, "memory note")}`);
  if (memoryDeletes.size) segments.push(`Forgot ${plural(memoryDeletes.size, "memory note")}`);
  if (generic && segments.length > 0) segments.push(`used ${plural(generic, "other tool")}`);
  if (segments.length === 0) return `Used ${plural(generic || total, "tool")}`;
  return segments.join(", ");
}

export function getToolCallPreview(args: Record<string, unknown> | null): string | null {
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
