/**
 * Legacy Chat Import Conversion
 *
 * Keeps support for importing pre-OPFS chat backups by converting them
 * into the current chat schema at import time.
 */

import type {
  AudioContent,
  Chat,
  Content,
  FileContent,
  ImageContent,
  Message,
  MessageError,
  Model,
  TextContent,
} from "@/shared/types/chat";

type ToolResultItem = TextContent | ImageContent | AudioContent | FileContent;

interface LegacyContentPart {
  type: string;
  name?: string;
  data?: string;
  mimeType?: string;
  text?: string;
  summary?: string;
  id?: string;
  arguments?: string;
  encrypted_content?: string;
  result?: LegacyContentPart[];
  [key: string]: unknown;
}

interface LegacyAttachment {
  type: string;
  name?: string;
  data: string;
}

interface LegacyToolCall {
  id?: string;
  name: string;
  arguments?: string;
}

interface LegacyToolResult {
  id?: string;
  name: string;
  arguments?: string;
  data?: string | LegacyContentPart[];
}

interface LegacyMessage {
  role?: string;
  content?: string | LegacyContentPart[];
  attachments?: LegacyAttachment[];
  toolCalls?: LegacyToolCall[];
  toolResult?: LegacyToolResult;
  error?: string | MessageError | null;
  [key: string]: unknown;
}

interface LegacyChat extends LegacyMessage {
  id?: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;
  model?: Model | null;
  created?: string | Date | null;
  updated?: string | Date | null;
  messages?: LegacyMessage[];
}

// ============================================================================
// CHAT MIGRATION
// ============================================================================

/**
 * Helper to create data URL from old mimeType + base64 data format.
 * If data is already a data URL, returns as-is.
 */
function toDataUrl(mimeType: string, data: string): string {
  if (data.startsWith("data:")) {
    return data;
  }
  return `data:${mimeType};base64,${data}`;
}

function migrateMessageError(error: LegacyMessage["error"]): MessageError | null | undefined {
  if (error === undefined || error === null) {
    return error;
  }

  if (typeof error === "string") {
    return { code: "legacy_error", message: error };
  }

  return error;
}

function migrateToolResultPart(part: LegacyContentPart): ToolResultItem {
  const migrated = migrateContentPart(part);

  if (
    migrated &&
    (migrated.type === "text" || migrated.type === "image" || migrated.type === "audio" || migrated.type === "file")
  ) {
    return migrated;
  }

  return {
    type: "text",
    text: migrated && "text" in migrated ? migrated.text : "",
  };
}

/**
 * Migrate content part from old format to new format.
 * Handles mimeType+data → data URL conversion for media types.
 * Returns null for parts that should be dropped (e.g. legacy compaction
 * blobs whose encrypted content can't be replayed).
 */
function migrateContentPart(part: LegacyContentPart): Content | null {
  if (!part || typeof part !== "object") throw new Error("Invalid message content in backup");
  // Normalize only the fields that changed. Spreading each part retains current
  // phases, tool metadata, incomplete flags, and future optional metadata.
  switch (part.type) {
    case "text": {
      const { data, ...rest } = part;
      return { ...rest, type: "text", text: part.text ?? data ?? "" } as TextContent;
    }
    case "image":
    case "audio":
    case "file": {
      const { mimeType, ...rest } = part;
      return {
        ...rest,
        name: part.name ?? (part.type === "file" ? "file" : undefined),
        data: mimeType ? toDataUrl(mimeType, part.data ?? "") : (part.data ?? ""),
      } as ImageContent | AudioContent | FileContent;
    }
    case "reasoning":
      return { ...part, type: "reasoning", id: part.id ?? crypto.randomUUID(), text: part.text ?? "" };
    case "tool_call":
      return {
        ...part,
        type: "tool_call",
        id: part.id ?? crypto.randomUUID(),
        name: part.name ?? "tool",
        arguments: part.arguments ?? "",
      };
    case "tool_result":
      return {
        ...part,
        type: "tool_result",
        id: part.id ?? crypto.randomUUID(),
        name: part.name ?? "tool",
        arguments: part.arguments ?? "",
        result: Array.isArray(part.result) ? part.result.map(migrateToolResultPart) : [],
      };
    case "summary":
    case "artifact_ref":
    case "runtime_feedback":
      return part as Content;
    case "compaction":
      // Provider-encrypted blobs from the removed server compaction API cannot
      // be replayed; surrounding messages remain available after import.
      return null;
    default:
      return { type: "text", text: part.text ?? part.data ?? "" };
  }
}

/**
 * Migrate old message format to new format.
 *
 * Handles all legacy formats:
 * - Separate mimeType + data fields → combined data URL
 * - attachments[] array → inline Content[]
 * - toolCalls / toolResult → tool_call / tool_result content
 * - reasoning field → ReasoningContent
 * - role: 'tool' → role: 'user'
 * - String content → TextContent[]
 *
 * This function is idempotent - already migrated messages pass through unchanged.
 */
function migrateMessage(msg: LegacyMessage): Message {
  const role: Message["role"] = msg.role === "assistant" ? "assistant" : "user";
  const error = migrateMessageError(msg.error);

  // Full migration for very old formats
  const content: Content[] = [];

  // Migrate text content
  if (typeof msg.content === "string" && msg.content) {
    content.push({ type: "text", text: msg.content });
  } else if (Array.isArray(msg.content)) {
    // Already array, copy existing content (with migration)
    for (const part of msg.content) {
      const migrated = migrateContentPart(part);
      if (migrated) content.push(migrated);
    }
  }

  // Migrate attachments to content
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === "image_data" || att.type === "image") {
        // att.data is already a data URL
        content.push({ type: "image", name: att.name, data: att.data });
      } else if (att.type === "file_data" || att.type === "file") {
        content.push({ type: "file", name: att.name ?? "file", data: att.data });
      } else if (att.type === "text") {
        content.push({ type: "text", text: `// ${att.name}\n${att.data}` });
      }
    }
  }

  // Migrate tool calls
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      content.push({
        type: "tool_call",
        id: tc.id ?? crypto.randomUUID(),
        name: tc.name,
        arguments: tc.arguments ?? "",
      });
    }
  }

  // Migrate tool result
  if (msg.toolResult) {
    const resultData = msg.toolResult.data;
    let result: ToolResultItem[];
    if (typeof resultData === "string") {
      result = [{ type: "text" as const, text: resultData }];
    } else if (Array.isArray(resultData)) {
      // Migrate nested content items
      result = resultData.map(migrateToolResultPart);
    } else {
      result = [];
    }
    content.push({
      type: "tool_result",
      id: msg.toolResult.id ?? crypto.randomUUID(),
      name: msg.toolResult.name,
      arguments: msg.toolResult.arguments ?? "",
      result,
    });
  }

  return { ...msg, role, content, error } as Message;
}

/**
 * Migrate an entire chat from old format to current schema.
 *
 * Migrates all messages in the chat to the new format.
 * Preserves original created/updated timestamps.
 * This function is idempotent - already migrated chats pass through unchanged.
 */
export function migrateChat(chat: LegacyChat): Chat {
  if (!chat || !Array.isArray(chat.messages)) throw new Error("Invalid chat: expected messages");
  // Ensure dates are Date objects (handle string dates from JSON)
  const created = chat.created ? (chat.created instanceof Date ? chat.created : new Date(chat.created)) : null;
  const updated = chat.updated ? (chat.updated instanceof Date ? chat.updated : new Date(chat.updated)) : null;

  return {
    id: chat.id || crypto.randomUUID(),
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    created,
    updated,
    model: chat.model ?? null,
    messages: Array.isArray(chat.messages) ? chat.messages.map(migrateMessage) : [],
  };
}
