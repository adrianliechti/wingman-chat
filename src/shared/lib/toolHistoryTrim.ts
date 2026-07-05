import { type Content, Role, type Message, type TextContent, type ToolResultContent } from "../types/chat";

const DEFAULT_RECENT_TURNS = 2;
const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_PREVIEW_CHARS = 300;

/**
 * Everything from the (`recentTurns`)-th-most-recent real user message onward —
 * i.e. the in-progress turn plus one prior turn as a buffer — is left fully
 * intact, however many tool calls it contains. Only tool payloads from turns
 * before that are candidates for trimming. A "real" user message mirrors
 * `injectContext`'s notion of a human turn: role `user` with some content that
 * isn't itself a tool_result (those are synthesized, not typed by a person).
 */
function findRecentTurnsBoundary(messages: Message[], recentTurns: number): number {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === Role.User && m.content.some((p) => p.type !== "tool_result")) {
      seen++;
      if (seen >= recentTurns) return i;
    }
  }
  return 0;
}

/**
 * Trim bulky tool payloads left over from earlier turns. Meant as one
 * `prepareMessages` stage (see `RunHooks` in agent.ts): a tool the model
 * leans on repeatedly within a single turn (search, code exec, image gen, …)
 * must keep every call from that turn at full fidelity — the model is still
 * actively reasoning over them — so trimming is scoped to turn boundaries,
 * not call counts. Turns before that keep a short preview of any oversized
 * tool_call argument or tool_result text instead of the full text, ahead of
 * ChatProvider's token-threshold summary compaction.
 */
export function trimBulkyToolHistory(
  messages: Message[],
  opts: { recentTurns?: number; maxChars?: number; previewChars?: number } = {},
): Message[] {
  const recentTurns = opts.recentTurns ?? DEFAULT_RECENT_TURNS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const previewChars = opts.previewChars ?? DEFAULT_PREVIEW_CHARS;

  const boundary = findRecentTurnsBoundary(messages, recentTurns);
  if (boundary === 0) return messages;

  return messages.map((message, index) => {
    if (index >= boundary) return message;

    let changed = false;
    const content = message.content.map((part): Content => {
      if (part.type === "tool_call") {
        const elidedArguments = elideBulkyArguments(part.arguments, maxChars, previewChars);
        if (elidedArguments !== part.arguments) {
          changed = true;
          return { ...part, arguments: elidedArguments };
        }
      }
      if (part.type === "tool_result") {
        const elidedResult = elideBulkyResult(part.result, maxChars, previewChars);
        if (elidedResult) {
          changed = true;
          return { ...part, result: elidedResult };
        }
      }
      return part;
    });
    return changed ? { ...message, content } : message;
  });
}

/** First `previewChars` of `text` plus a note of how much was cut. */
function preview(text: string, previewChars: number): string {
  return `${text.slice(0, previewChars)}\n…[${text.length - previewChars} more chars omitted to save context — call the tool again if you need the full content]`;
}

/** Replace oversized string fields in a tool call's arguments JSON with a preview. */
function elideBulkyArguments(raw: string, maxChars: number, previewChars: number): string {
  try {
    const args = JSON.parse(raw) as unknown;
    if (typeof args !== "object" || args === null || Array.isArray(args)) return raw;
    const record = args as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === "string" && value.length > maxChars) {
        record[key] = preview(value, previewChars);
        changed = true;
      }
    }
    return changed ? JSON.stringify(record) : raw;
  } catch {
    // Unparseable arguments (model mis-escaped) — leave untouched.
    return raw;
  }
}

/**
 * Replace oversized text entries in a tool result with a preview. Binary
 * content (image/audio/file) is already a small placeholder on the wire (see
 * `serializeToolResultForApi`), so only text needs trimming here.
 */
function elideBulkyResult(
  result: ToolResultContent["result"],
  maxChars: number,
  previewChars: number,
): ToolResultContent["result"] | null {
  let changed = false;
  const elided = result.map((item) => {
    if (item.type === "text" && item.text.length > maxChars) {
      changed = true;
      return { type: "text", text: preview(item.text, previewChars) } satisfies TextContent;
    }
    return item;
  });
  return changed ? elided : null;
}
