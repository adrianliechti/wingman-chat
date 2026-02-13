/**
 * V1 Format Migration - Import Support
 * 
 * Handles importing old backup formats for chats and repositories.
 * This module provides migration functions for JSON import files.
 * 
 * REMOVE AFTER MARCH 2026 when all users have migrated their backups.
 */

import type { Chat, Message, Content } from '@/shared/types/chat';
import type { Repository, RepositoryFile } from '@/features/repository/types/repository';
import type { Skill } from './skillParser';
import { parseSkillFile } from './skillParser';

// ============================================================================
// CHAT MIGRATION
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
 * Migrate an entire chat from old format to current schema.
 * 
 * Migrates all messages in the chat to the new format.
 * Preserves original created/updated timestamps.
 * This function is idempotent - already migrated chats pass through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateChat(chat: any): Chat {
  // Ensure dates are Date objects (handle string dates from JSON)
  const created = chat.created 
    ? (chat.created instanceof Date ? chat.created : new Date(chat.created))
    : null;
  const updated = chat.updated 
    ? (chat.updated instanceof Date ? chat.updated : new Date(chat.updated))
    : null;
    
  return {
    ...chat,
    created,
    updated,
    messages: Array.isArray(chat.messages) 
      ? chat.messages.map(migrateMessage)
      : [],
  };
}

// ============================================================================
// REPOSITORY MIGRATION
// ============================================================================

/**
 * Old repository file format (pre-folder structure).
 * Text and vectors were embedded directly in the file object.
 */
interface OldRepositoryFile {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  text?: string;
  segments?: Array<{
    text: string;
    vector: number[];
  }>;
  error?: string;
  uploadedAt: string | Date;
}

/**
 * Old repository format (pre-folder structure).
 * Files were embedded directly in the repository object with all data.
 */
interface OldRepository {
  id: string;
  name: string;
  embedder?: string;
  instructions?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  files?: OldRepositoryFile[];
}

/**
 * Migrate a repository file from old format.
 * Handles date conversion and ensures all required fields exist.
 */
function migrateRepositoryFile(file: OldRepositoryFile): RepositoryFile {
  return {
    id: file.id || crypto.randomUUID(),
    name: file.name || 'Unknown File',
    status: file.status || 'completed',
    progress: typeof file.progress === 'number' ? file.progress : 100,
    text: file.text,
    segments: file.segments,
    error: file.error,
    uploadedAt: file.uploadedAt instanceof Date 
      ? file.uploadedAt 
      : new Date(file.uploadedAt || Date.now()),
  };
}

/**
 * Migrate a repository from old format to current schema.
 * 
 * Handles:
 * - Date string → Date object conversion
 * - Missing embedder field (defaults to config or 'openai')
 * - File migration with embedded text/vectors
 * - Missing required fields
 * 
 * This function is idempotent - already migrated repositories pass through unchanged.
 */
export function migrateRepository(repo: OldRepository, defaultEmbedder: string = 'openai'): Repository {
  return {
    id: repo.id || crypto.randomUUID(),
    name: repo.name || 'Imported Repository',
    embedder: repo.embedder || defaultEmbedder,
    instructions: repo.instructions,
    createdAt: repo.createdAt instanceof Date 
      ? repo.createdAt 
      : new Date(repo.createdAt || Date.now()),
    updatedAt: repo.updatedAt instanceof Date 
      ? repo.updatedAt 
      : new Date(repo.updatedAt || Date.now()),
    files: repo.files?.map(migrateRepositoryFile),
  };
}

/**
 * Migrate an array of repositories from an old backup format.
 * 
 * @param repositories - Array of repositories in old format
 * @param defaultEmbedder - Default embedder to use if not specified
 * @returns Array of migrated repositories
 */
export function migrateRepositories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repositories: any[],
  defaultEmbedder: string = 'openai'
): Repository[] {
  return repositories.map(repo => migrateRepository(repo, defaultEmbedder));
}

/**
 * Migrate an array of chats from an old backup format.
 * 
 * @param chats - Array of chats in old format
 * @returns Array of migrated chats
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateChats(chats: any[]): Chat[] {
  return chats.map(migrateChat);
}

// ============================================================================
// SKILL MIGRATION
// ============================================================================

/**
 * Migrate a skill from old JSON format to current schema.
 * 
 * Old formats may have:
 * - Embedded content as string
 * - Missing enabled field
 * - Different field names
 * 
 * @param skill - Skill in potentially old format
 * @returns Migrated skill
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateSkill(skill: any): Skill | null {
  // If it's already a proper skill object
  if (skill.name && skill.description !== undefined) {
    return {
      id: skill.id || crypto.randomUUID(),
      name: skill.name,
      description: skill.description || '',
      content: skill.content || skill.instructions || '',
      enabled: skill.enabled !== false,
    };
  }
  
  // Try to parse as SKILL.md content
  if (typeof skill === 'string') {
    const result = parseSkillFile(skill);
    if (result.success) {
      return {
        ...result.skill,
        id: crypto.randomUUID(),
        enabled: true,
      };
    }
  }
  
  return null;
}

/**
 * Migrate an array of skills from an old backup format.
 * 
 * @param skills - Array of skills in old format
 * @returns Array of migrated skills (nulls filtered out)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateSkills(skills: any[]): Skill[] {
  return skills
    .map(migrateSkill)
    .filter((s): s is Skill => s !== null);
}
