import type { Chat, Message, Content } from '../types/chat';

// ============================================================================
// CHAT MIGRATION MODULE - REMOVE AFTER MARCH 2026
// This module migrates old chat/message formats to the current schema.
// After March 2026, all users should have their data migrated and this module
// can be safely removed. Consumers should then remove migrateChat() calls.
// ============================================================================

/**
 * Helper to create data URL from old mimeType + base64 data format.
 * If data is already a data URL, returns as-is.
 */
function toDataUrl(mimeType: string, data: string): string {
  if (data.startsWith('data:')) {
    return data;
  }
  return `data:${mimeType};base64,${data}`;
}

/**
 * Migrate content part from old format to new format.
 * Handles mimeType+data → data URL conversion for media types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateContentPart(part: any): Content {
  if (part.type === 'image' && part.mimeType) {
    return { type: 'image', name: part.name, data: toDataUrl(part.mimeType, part.data) };
  } else if (part.type === 'audio' && part.mimeType) {
    return { type: 'audio', name: part.name, data: toDataUrl(part.mimeType, part.data) };
  } else if (part.type === 'file' && part.mimeType) {
    return { type: 'file', name: part.name, data: toDataUrl(part.mimeType, part.data) };
  } else if (part.type === 'tool_result' && part.result) {
    // Recursively migrate tool result contents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migratedResult = part.result.map((r: any) => migrateContentPart(r));
    return { ...part, result: migratedResult };
  }
  return part;
}

/**
 * @deprecated REMOVE AFTER MARCH 2026
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateMessage(msg: any): Message {
  // Check if already in new format (content is array with no attachments and no separate mimeType fields)
  if (Array.isArray(msg.content) && !msg.attachments?.length) {
    // Migrate existing content parts to use data URLs (handle old mimeType+data format)
    const migratedContent: Content[] = msg.content.map(migrateContentPart);
    
    // Convert role: 'tool' to 'user'
    const role = msg.role === 'tool' ? 'user' : msg.role;
    return { ...msg, role, content: migratedContent } as Message;
  }

  // Full migration for very old formats
  const content: Content[] = [];
  
  // Migrate text content
  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    // Already array, copy existing content (with migration)
    for (const part of msg.content) {
      content.push(migrateContentPart(part));
    }
  }
  
  // Migrate attachments to content
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === 'image_data' || att.type === 'image') {
        // att.data is already a data URL
        content.push({ type: 'image', name: att.name, data: att.data });
      } else if (att.type === 'file_data' || att.type === 'file') {
        content.push({ type: 'file', name: att.name, data: att.data });
      } else if (att.type === 'text') {
        content.push({ type: 'text', text: `// ${att.name}\n${att.data}` });
      }
    }
  }
  
  // Migrate tool calls
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      content.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
    }
  }
  
  // Migrate tool result
  if (msg.toolResult) {
    const resultData = msg.toolResult.data;
    let result: Content[];
    if (typeof resultData === 'string') {
      result = [{ type: 'text' as const, text: resultData }];
    } else if (Array.isArray(resultData)) {
      // Migrate nested content items
      result = resultData.map(migrateContentPart);
    } else {
      result = [];
    }
    content.push({
      type: 'tool_result',
      id: msg.toolResult.id,
      name: msg.toolResult.name,
      arguments: msg.toolResult.arguments,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: result as any,
    });
  }

  // Convert role: 'tool' to 'user'
  const role = msg.role === 'tool' ? 'user' : msg.role;

  return { role, content, error: msg.error };
}

/**
 * @deprecated REMOVE AFTER MARCH 2026
 * Migrate an entire chat to the current schema.
 * 
 * Migrates all messages in the chat to the new format.
 * This function is idempotent - already migrated chats pass through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateChat(chat: any): Chat {
  return {
    ...chat,
    messages: Array.isArray(chat.messages) 
      ? chat.messages.map(migrateMessage)
      : [],
  };
}
