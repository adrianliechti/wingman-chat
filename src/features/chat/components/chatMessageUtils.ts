import type { ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import { toolArgumentPath, tryParseToolArguments } from "@/shared/lib/toolArguments";
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
import { extractUiFences } from "@/shared/lib/inlineUi/protocol";

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
  return result?.state === "error";
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
  const start = turnStart(messages, assistantIndex);
  for (let i = start; i <= assistantIndex; i++) {
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
      }
    }
  }
  const paths = [...seen].filter((path) => !isMemoryPath(path));
  const isUiSource = (path: string) => path.split("/").at(-1)?.toLowerCase() === "ui.json";
  if (!paths.some(isUiSource)) return paths;
  const hasInlineUi = messages
    .slice(start, assistantIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.parts.some((part) => part.type === "text" && extractUiFences(part.content).length > 0),
    );
  // The intermediate source stays in the workspace; the rendered interface is the chat deliverable.
  return hasInlineUi ? paths.filter((path) => !isUiSource(path)) : paths;
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
  return isActivityMessage(message) && !hasReasoning(message);
}

/** Tool rounds, possibly with reasoning, but no reply: work a finished turn can fold away. */
export function isActivityMessage(message: UIMessage): boolean {
  if (message.role !== "assistant" || message.parts.length === 0 || messageMetadata(message).error) return false;
  return (
    message.parts.some((part) => part.type === "tool-call") &&
    !hasText(message) &&
    !hasMedia(message) &&
    !message.parts.some(
      (part) => part.type === "subagent" || part.type === "structured-output" || part.type === "ui-resource",
    )
  );
}

/** A result that must stay visible standalone (interactive/rich), never folded. */
export function isRichToolResult(result: ToolResultPart): boolean {
  if (isFailedResult(result)) return true;
  // Inline media (images/audio/files) is worth keeping in view.
  return toolResultContent(result).some(isMediaPart);
}

function hostsToolCall(message: UIMessage, toolCallId?: string | null): boolean {
  if (!toolCallId) return false;
  return message.parts.some((p) => p.type === "tool-call" && p.id === toolCallId);
}

export type RenderUnit =
  | { kind: "message"; index: number; foldedReasoning?: boolean }
  | { kind: "toolGroup"; indices: number[]; reply?: number };

function thoughts(message: UIMessage): string[] {
  return message.parts.flatMap((part) => (part.type === "thinking" && part.content ? [part.content] : []));
}

/** Reasoning that opens a reply, once its text has started and the thinking is finished. */
export function leadingReasoning(message: UIMessage | undefined): string[] {
  if (message?.role !== "assistant" || messageMetadata(message).error) return [];
  const first = message.parts.findIndex((part) => part.type !== "thinking");
  const next = message.parts[first];
  if (first === -1 || next.type !== "text" || !next.content) return [];
  return thoughts({ ...message, parts: message.parts.slice(0, first) });
}

/** Every thought a tool group folds: its own rounds' reasoning, then the reply's opening reasoning. */
export function groupThoughts(messages: readonly UIMessage[], indices: number[], reply?: number): string[] {
  return [
    ...indices.flatMap((index) => thoughts(messages[index])),
    ...(reply === undefined ? [] : leadingReasoning(messages[reply])),
  ];
}

/**
 * Partition messages into standalone messages and folded tool groups: runs of
 * finished activity messages (tool rounds and their reasoning) that, with the
 * reply's opening reasoning, hold at least two steps. `pendingElicitationToolCallId`
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
  let foldedReply: number | undefined;
  const addMessage = (index: number) => {
    if (!represented(messages[index]))
      units.push(
        index === foldedReply ? { kind: "message", index, foldedReasoning: true } : { kind: "message", index },
      );
  };
  const limit = isResponding ? messages.length - 1 : messages.length;
  const groupable = (message: UIMessage) =>
    isActivityMessage(message) &&
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
      // The reply (even while it streams) gives up its opening reasoning to the group.
      const replyThoughts = leadingReasoning(messages[j]).length;
      const steps = results + replyThoughts + indices.reduce((sum, index) => sum + thoughts(messages[index]).length, 0);
      if (results >= 1 && steps >= 2) {
        if (replyThoughts) foldedReply = j;
        units.push(replyThoughts ? { kind: "toolGroup", indices, reply: j } : { kind: "toolGroup", indices });
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
        toolArgumentPath(args) ?? (typeof args?.from === "string" ? args.from : `${call.name}:${call.id}`);

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

/** "Used 2 tools and 2 thoughts": the tool summary plus every thought the group folds. */
export function summarizeActivity(messages: readonly UIMessage[], indices: number[], reply?: number): string {
  const summary = summarizeToolGroup(messages, indices);
  const count = groupThoughts(messages, indices, reply).length;
  return count ? `${summary} and ${plural(count, "thought")}` : summary;
}

export { getToolCallPreview } from "@/shared/lib/toolPreview";
