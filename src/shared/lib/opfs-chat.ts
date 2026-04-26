/**
 * OPFS Chat — Chat-scoped blob storage, extraction/rehydration pipeline, and stored types.
 */

import type {
  AudioContent,
  Chat,
  Content,
  FileContent,
  ImageContent,
  Message,
  ToolResultContent,
} from "@/shared/types/chat";
import {
  blobToDataUrl,
  createBlobRef,
  dataUrlToBlob,
  deleteFile,
  isDataUrl,
  listFiles,
  parseBlobRef,
  readBlob,
  writeBlob,
} from "./opfs-core";
import { lookupContentType } from "./utils";

// ============================================================================
// Co-located Blob Storage (blobs stored within their parent entity folder)
// ============================================================================

/**
 * Store a blob in a chat's blobs folder and return its ID.
 */
export async function storeChatBlob(chatId: string, blob: Blob): Promise<string> {
  const blobId = crypto.randomUUID();
  await writeBlob(`chats/${chatId}/blobs/${blobId}.bin`, blob);
  return blobId;
}

/**
 * Retrieve a blob from a chat's blobs folder by ID.
 */
export async function getChatBlob(chatId: string, blobId: string): Promise<Blob | undefined> {
  return readBlob(`chats/${chatId}/blobs/${blobId}.bin`);
}

/**
 * Delete a blob from a chat's blobs folder.
 */
export async function deleteChatBlob(chatId: string, blobId: string): Promise<void> {
  await deleteFile(`chats/${chatId}/blobs/${blobId}.bin`);
}

/**
 * List all blob IDs in a chat's blobs folder.
 */
export async function listChatBlobs(chatId: string): Promise<string[]> {
  const files = await listFiles(`chats/${chatId}/blobs`);
  return files.map((f) => f.replace(/\.bin$/, ""));
}

// ============================================================================
// Message Blob Extraction and Rehydration (Chat-scoped)
// ============================================================================

/** Content part with blob reference instead of data URL */
export type BlobRefImageContent = Omit<ImageContent, "data"> & { data: string }; // data is blob:id
export type BlobRefAudioContent = Omit<AudioContent, "data"> & { data: string };
export type BlobRefFileContent = Omit<FileContent, "data"> & { data: string };

export type StoredContent =
  | Exclude<Content, ImageContent | AudioContent | FileContent | ToolResultContent>
  | BlobRefImageContent
  | BlobRefAudioContent
  | BlobRefFileContent
  | (Omit<ToolResultContent, "result"> & { result: StoredContent[] });

export interface StoredMessage {
  role: "user" | "assistant";
  content: StoredContent[];
  error?: { code: string; message: string } | null;
}

export interface StoredChat {
  id: string;
  title?: string;
  customTitle?: string;
  customIndex?: number;
  created: string | null;
  updated: string | null;
  model: Chat["model"];
  messages: StoredMessage[];
}

/**
 * Extract binary data from a content part and store as blob in chat folder.
 * Returns the content with data URL replaced by blob reference.
 */
async function extractContentBlobForChat(chatId: string, content: Content): Promise<StoredContent> {
  if (content.type === "image" || content.type === "audio" || content.type === "file") {
    if (isDataUrl(content.data)) {
      const blob = dataUrlToBlob(content.data);
      const blobId = await storeChatBlob(chatId, blob);
      return { ...content, data: createBlobRef(blobId) };
    }
    // Already a blob ref or other format, keep as-is
    return content as StoredContent;
  }

  if (content.type === "tool_result") {
    const extractedResult = await Promise.all(
      content.result.map((r) => extractContentBlobForChat(chatId, r as Content)),
    );
    return { ...content, result: extractedResult } as StoredContent;
  }

  return content as StoredContent;
}

/**
 * Rehydrate a content part by loading blob data from chat folder and converting to data URL.
 */
async function rehydrateContentBlobForChat(chatId: string, content: StoredContent): Promise<Content> {
  if (content.type === "image" || content.type === "audio" || content.type === "file") {
    const blobId = parseBlobRef(content.data);
    if (blobId) {
      const blob = await getChatBlob(chatId, blobId);

      if (blob) {
        // .bin files lose their MIME on OPFS read-back; re-infer from the content name.
        const needsMime = !blob.type || blob.type === "application/octet-stream";
        let effectiveBlob = blob;
        if (needsMime) {
          const ext = (content as { name?: string }).name?.split(".").pop() ?? "";
          const inferredMime =
            lookupContentType(ext) ??
            (content.type === "image" ? "image/png" : content.type === "audio" ? "audio/wav" : undefined);
          if (inferredMime) {
            effectiveBlob = new Blob([blob], { type: inferredMime });
          }
        }
        const dataUrl = await blobToDataUrl(effectiveBlob);
        return { ...content, data: dataUrl };
      }
      // Blob not found, return with empty data or placeholder
      console.warn(`Blob not found: ${blobId}`);
      return { ...content, data: "" };
    }
    // Not a blob ref, return as-is
    return content as Content;
  }

  if (content.type === "tool_result") {
    const rehydratedResult = await Promise.all(
      content.result.map((r) => rehydrateContentBlobForChat(chatId, r as StoredContent)),
    );
    return { ...content, result: rehydratedResult } as Content;
  }

  return content as Content;
}

/**
 * Extract all binary data from a message and store as blobs in chat folder.
 */
export async function extractMessageBlobsForChat(chatId: string, message: Message): Promise<StoredMessage> {
  const extractedContent = await Promise.all(message.content.map((c) => extractContentBlobForChat(chatId, c)));

  return {
    role: message.role,
    content: extractedContent,
    error: message.error,
  };
}

/**
 * Rehydrate all blob references in a message from chat folder.
 */
export async function rehydrateMessageBlobsForChat(chatId: string, message: StoredMessage): Promise<Message> {
  const rehydratedContent = await Promise.all(message.content.map((c) => rehydrateContentBlobForChat(chatId, c)));

  return {
    role: message.role,
    content: rehydratedContent,
    error: message.error,
  };
}

/**
 * Extract all binary data from a chat and store as blobs in chat folder.
 * Returns a StoredChat suitable for JSON serialization.
 * Note: Artifacts should be saved separately via saveArtifacts().
 */
export async function extractChatBlobs(chat: Chat): Promise<StoredChat> {
  const extractedMessages = await Promise.all(chat.messages.map((m) => extractMessageBlobsForChat(chat.id, m)));

  return {
    id: chat.id,
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    created: chat.created instanceof Date ? chat.created.toISOString() : (chat.created as unknown as string) || null,
    updated: chat.updated instanceof Date ? chat.updated.toISOString() : (chat.updated as unknown as string) || null,
    model: chat.model,
    messages: extractedMessages,
  };
}

/**
 * Rehydrate all blob references in a stored chat.
 * Returns a Chat with all data URLs restored.
 * Note: Artifacts should be loaded separately via loadArtifacts().
 */
export async function rehydrateChatBlobs(stored: StoredChat): Promise<Chat> {
  const rehydratedMessages = await Promise.all(stored.messages.map((m) => rehydrateMessageBlobsForChat(stored.id, m)));

  return {
    id: stored.id,
    title: stored.title,
    customTitle: stored.customTitle,
    customIndex: stored.customIndex,
    created: stored.created ? new Date(stored.created) : null,
    updated: stored.updated ? new Date(stored.updated) : null,
    model: stored.model,
    messages: rehydratedMessages,
  };
}

/**
 * Collect all blob IDs referenced in a stored message.
 */
function collectMessageBlobIds(message: StoredMessage): string[] {
  const ids: string[] = [];

  function collectFromContent(content: StoredContent): void {
    if (content.type === "image" || content.type === "audio" || content.type === "file") {
      const blobId = parseBlobRef(content.data);
      if (blobId) {
        ids.push(blobId);
      }
    } else if (content.type === "tool_result") {
      content.result.forEach(collectFromContent);
    }
  }

  message.content.forEach(collectFromContent);
  return ids;
}

/**
 * Collect all blob IDs referenced in a stored chat.
 */
export function collectChatBlobIds(chat: StoredChat): string[] {
  const ids: string[] = [];
  for (const message of chat.messages) {
    ids.push(...collectMessageBlobIds(message));
  }
  return ids;
}
