import { Role, type Content, type Message, type ReasoningContent } from "../types/chat";

/**
 * Replay opaque reasoning across tool calls and human turns; the provider's
 * reasoning context mode decides which items to use. Model and request-prefix
 * bindings conservatively invalidate payloads when the configuration changes.
 * Key or deployment changes are handled by retrying a provider rejection
 * without the payloads.
 */

/** Identity a replayable reasoning payload is bound to. */
export interface ReasoningBinding {
  model: string;
  prefix: string;
}

/** Fingerprint of the request prefix (instructions and tool schemas) a payload was produced with. */
export function reasoningPrefix(instructions: string, tools: unknown): string {
  return hash53(JSON.stringify([instructions, tools ?? null]));
}

// cyrb53 (public domain): a small non-cryptographic 53-bit string hash. A
// collision only risks replaying a payload the provider then rejects, which the
// agent loop recovers from.
function hash53(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

type ReplayableReasoning = ReasoningContent & { encryptedContent: string };

export function isReplayableReasoning(part: Content): part is ReplayableReasoning {
  return part.type === "reasoning" && !!part.encryptedContent && !!part.id;
}

export function hasReplayableReasoning(messages: Message[]): boolean {
  return messages.some((message) => message.content.some(isReplayableReasoning));
}

/**
 * Reset the owned history once when switching configuration. Clearing only the
 * request projection would let stale bindings suppress every later response's
 * fresh reasoning. Clear all payloads together to avoid partial replay.
 */
export function clearIncompatibleReasoning(messages: Message[], binding: ReasoningBinding): Message[] {
  const incompatible = messages.some((message) =>
    message.content.some(
      (part) => isReplayableReasoning(part) && (part.model !== binding.model || part.prefix !== binding.prefix),
    ),
  );
  return incompatible ? clearReplayableReasoning(messages) : messages;
}

/**
 * Replay compatible payloads from all turns, including models whose context
 * mode uses earlier reasoning. Keep this wire-only guard for callers that do
 * not normalize their history through the agent loop.
 */
export function replayableReasoning(messages: Message[], binding: ReasoningBinding | undefined): Set<Content> {
  const parts = new Set<Content>();
  if (!binding) return parts;
  for (const message of messages) {
    if (message.role !== Role.Assistant) continue;
    for (const part of message.content) {
      if (!isReplayableReasoning(part)) continue;
      if (part.model !== binding.model || part.prefix !== binding.prefix) return new Set();
      parts.add(part);
    }
  }
  return parts;
}

/** Drop the payloads while keeping visible reasoning text. Returns the same array when nothing changed. */
export function clearReplayableReasoning(messages: Message[]): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.content.some(isReplayableReasoning)) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part): Content => {
        if (!isReplayableReasoning(part)) return part;
        const visible: ReasoningContent = { type: "reasoning", id: part.id, text: part.text };
        if (part.summary) visible.summary = part.summary;
        return visible;
      }),
    };
  });
  return changed ? next : messages;
}
