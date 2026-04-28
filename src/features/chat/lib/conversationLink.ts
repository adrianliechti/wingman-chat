import type { Content, Message } from "@/shared/types/chat";

const SIZE_LIMIT = 256 * 1024; // 256 KB
const MESSAGE_LIMIT = 200;
const ALLOWED_TYPES = new Set(["text", "image", "file", "reasoning", "audio"]);

export interface ConversationLinkPayload {
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toBase64Url(data: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a conversation payload as a compressed base64url string suitable
 * for embedding in a URL hash: `/chat#import=<result>`.
 */
export async function encodeConversationLink(payload: ConversationLinkPayload): Promise<string> {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return toBase64Url(compressed);
}

/**
 * Decode and validate a compressed conversation link (the canonical `import=` format).
 */
export async function decodeConversationLink(value: string): Promise<ConversationLinkPayload> {
  const compressed = fromBase64Url(value);
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const decompressed = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  const json = new TextDecoder().decode(decompressed);
  if (json.length > SIZE_LIMIT) throw new Error("Conversation link payload too large");
  return parseConversationLink(JSON.parse(json));
}

/**
 * Decode and validate an uncompressed conversation link (the `import_json=` escape-hatch format).
 */
export function decodeConversationLinkJson(value: string): ConversationLinkPayload {
  const json = decodeURIComponent(value);
  if (json.length > SIZE_LIMIT) throw new Error("Conversation link payload too large");
  return parseConversationLink(JSON.parse(json));
}

/**
 * Validate a raw parsed object and return a typed `ConversationLinkPayload`.
 * Strips disallowed content parts (tool_call, tool_result, compaction) silently.
 * Throws a descriptive error if the payload is structurally invalid.
 */
export function parseConversationLink(raw: unknown): ConversationLinkPayload {
  if (!raw || typeof raw !== "object") throw new Error("Invalid conversation link payload");
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    throw new Error("Conversation link must contain a non-empty messages array");
  }
  if (obj.messages.length > MESSAGE_LIMIT) {
    throw new Error(`Conversation link exceeds message limit (max ${MESSAGE_LIMIT})`);
  }

  const messages: Message[] = obj.messages.map((m: unknown, i: number) => {
    if (!m || typeof m !== "object") throw new Error(`Message at index ${i} is not an object`);
    const msg = m as Record<string, unknown>;

    if (msg.role !== "user" && msg.role !== "assistant") {
      throw new Error(`Message at index ${i} has invalid role: ${String(msg.role)}`);
    }
    if (!Array.isArray(msg.content)) {
      throw new Error(`Message at index ${i} is missing a content array`);
    }

    // Strip disallowed content parts; keep only safe/portable types
    const content = (msg.content as unknown[]).filter(
      (p): p is Content =>
        !!p && typeof p === "object" && ALLOWED_TYPES.has((p as Record<string, unknown>).type as string),
    );

    return { role: msg.role as "user" | "assistant", content };
  });

  return { messages };
}
