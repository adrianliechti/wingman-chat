import { type Content, Role, type Message, type TextContent, type ToolResultContent } from "../types/chat";

const DEFAULT_RECENT_TURNS = 2;
const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_PREVIEW_CHARS = 300;

export interface ToolArgumentElisionOptions {
  maxChars?: number;
  previewChars?: number;
}

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
  const recentTurns = Math.max(1, Math.floor(opts.recentTurns ?? DEFAULT_RECENT_TURNS));
  const elision = normalizeElisionOptions(opts);

  const boundary = findRecentTurnsBoundary(messages, recentTurns);
  if (boundary === 0) return messages;

  return messages.map((message, index) => {
    if (index >= boundary) return message;

    let changed = false;
    const content = message.content.map((part): Content => {
      if (part.type === "tool_call") {
        const elidedArguments = elideToolArguments(part.arguments, elision);
        if (elidedArguments !== part.arguments) {
          changed = true;
          return { ...part, arguments: elidedArguments };
        }
      }
      if (part.type === "tool_result") {
        const elidedResult = elideBulkyResult(part.result, elision.maxChars, elision.previewChars);
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

/** Return a shorter preview when that actually saves space. */
function elideText(text: string, maxChars: number, previewChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, previewChars);
  const note = `…[${text.length - previewChars} more chars omitted to save context — re-run the tool or re-read the source if needed]`;
  const elided = head ? `${head}\n${note}` : note;
  return elided.length < text.length ? elided : text;
}

function normalizeElisionOptions(opts: ToolArgumentElisionOptions): Required<ToolArgumentElisionOptions> {
  const maxChars = Math.max(0, Math.floor(opts.maxChars ?? DEFAULT_MAX_CHARS));
  const previewChars = Math.max(0, Math.min(maxChars, Math.floor(opts.previewChars ?? DEFAULT_PREVIEW_CHARS)));
  return { maxChars, previewChars };
}

function elideJsonStrings(
  value: unknown,
  maxChars: number,
  previewChars: number,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const elided = elideText(value, maxChars, previewChars);
    return { value: elided, changed: elided !== value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const elided = elideJsonStrings(item, maxChars, previewChars);
      changed ||= elided.changed;
      return elided.value;
    });
    return changed ? { value: next, changed } : { value, changed: false };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const elided = elideJsonStrings(item, maxChars, previewChars);
      changed ||= elided.changed;
      next[key] = elided.value;
    }
    return changed ? { value: next, changed } : { value, changed: false };
  }

  return { value, changed: false };
}

/** Replace oversized strings anywhere in a tool-call arguments JSON. */
export function elideToolArguments(raw: string, opts: ToolArgumentElisionOptions = {}): string {
  const { maxChars, previewChars } = normalizeElisionOptions(opts);
  if (raw.length <= maxChars) return raw;

  try {
    const args = JSON.parse(raw) as unknown;
    if (typeof args !== "object" || args === null || Array.isArray(args)) return raw;
    const elided = elideJsonStrings(args, maxChars, previewChars);
    return elided.changed ? JSON.stringify(elided.value) : raw;
  } catch {
    // Keep recent malformed calls intact for self-correction; once a caller
    // chooses to compact them, wrap a preview in valid JSON for safe replay.
    const candidate = JSON.stringify({ elidedArguments: elideText(raw, maxChars, previewChars) });
    return candidate.length < raw.length ? candidate : raw;
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
    if (item.type === "text") {
      const text = elideText(item.text, maxChars, previewChars);
      if (text !== item.text) {
        changed = true;
        return { type: "text", text } satisfies TextContent;
      }
    }
    return item;
  });
  return changed ? elided : null;
}
