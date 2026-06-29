/**
 * Compaction for persisted notebook-chat agent messages.
 *
 * The chat now keeps the full agent run in its history (assistant tool
 * calls + tool results), so the model remembers what it read and edited
 * across turns. Raw tool traffic is bulky though — a single source read can
 * be 50 KB — so before persisting (and re-sending next turn) we truncate
 * long text payloads. The model is told in its instructions that earlier
 * tool results may be truncated and to re-read before editing.
 */

import type { Message } from "@/shared/types/chat";

const MAX_TOOL_TEXT_CHARS = 1500;

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_TEXT_CHARS)}\n…[truncated ${text.length - MAX_TOOL_TEXT_CHARS} chars — re-read the source if you need the full current text]`;
}

/** Elide long string fields inside a tool-call arguments JSON (e.g. source_create_file content). */
function compactArguments(raw: string): string {
  if (raw.length <= MAX_TOOL_TEXT_CHARS) return raw;
  try {
    const args = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string" && value.length > MAX_TOOL_TEXT_CHARS) {
        args[key] = truncate(value);
        changed = true;
      }
    }
    return changed ? JSON.stringify(args) : raw;
  } catch {
    return raw;
  }
}

/** Return a copy of an agent message with bulky tool payloads truncated. */
export function compactAgentMessage(message: Message): Message {
  let changed = false;
  const content = message.content.map((part) => {
    if (part.type === "tool_call") {
      const args = compactArguments(part.arguments);
      if (args === part.arguments) return part;
      changed = true;
      return { ...part, arguments: args };
    }
    if (part.type === "tool_result") {
      const args = compactArguments(part.arguments);
      const result = part.result.map((r) => {
        if (r.type !== "text" || r.text.length <= MAX_TOOL_TEXT_CHARS) return r;
        return { ...r, text: truncate(r.text) };
      });
      const resultChanged = result.some((r, i) => r !== part.result[i]);
      if (args === part.arguments && !resultChanged) return part;
      changed = true;
      return { ...part, arguments: args, result };
    }
    return part;
  });
  return changed ? { ...message, content } : message;
}
