/**
 * OPFS Chat — Chat-scoped blob storage and the stored chat record.
 *
 * A chat is saved as the runtime's own transcript. Only media bytes leave the
 * record: every data-backed part becomes a `blob:` reference into the chat's
 * blob folder and comes back as data when the chat, a request, or a view
 * needs it.
 */

import type { MessagePart, UIMessage } from "@tanstack/ai";
import type { Chat } from "@/shared/types/chat";
import {
  isMediaPart,
  mapMessages,
  mediaDataUrl,
  mediaMetadata,
  mediaMimeType,
  toolResultMetadata,
  type MediaPart,
} from "./messages";
import {
  blobToDataUrl,
  createBlobRef,
  dataUrlToBlob,
  deleteFile,
  isDataUrl,
  listFiles,
  parseBlobRef,
  readBlob,
  readFileMetadata,
  writeBlob,
} from "./opfs-core";
import { fileExtension, lookupContentType } from "./utils";

// ============================================================================
// Co-located Blob Storage (blobs stored within their parent entity folder)
// ============================================================================

/**
 * Store a blob in a chat's blobs folder and return its ID.
 */
export async function storeChatBlob(chatId: string, blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const blobId = `sha256-${hash}`;
  const path = `chats/${chatId}/blobs/${blobId}.bin`;
  if ((await readFileMetadata(path))?.size !== blob.size) await writeBlob(path, blob);
  return blobId;
}

/**
 * Retrieve a blob from a chat's blobs folder by ID.
 */
export async function getChatBlob(chatId: string, blobId: string): Promise<Blob | undefined> {
  return (await readBlob(`chats/${chatId}/blobs/${blobId}.bin`)) ?? readBlob(`blobs/${blobId}.bin`);
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
// Stored record
// ============================================================================

export const STORED_CHAT_VERSION = 2;

/** The saved chat: the native transcript with media as blob references, plus the runtime's resume pointer. */
export interface StoredChat extends Omit<Chat, "created" | "updated"> {
  version: typeof STORED_CHAT_VERSION;
  created: string | null;
  updated: string | null;
}

// ============================================================================
// Media parts: data <-> blob reference
// ============================================================================

/** The blob a stored media part refers to, if it is a reference. */
function mediaBlobRef(part: MediaPart): string | null {
  return part.source.type === "url" ? parseBlobRef(part.source.value) : null;
}

function* mediaParts(parts: readonly MessagePart[]): Generator<MediaPart> {
  for (const part of parts) {
    if (isMediaPart(part)) yield part;
    else if (part.type === "tool-result") {
      if (Array.isArray(part.content)) yield* mediaParts(part.content);
      yield* mediaParts(toolResultMetadata(part).result ?? []);
    } else if (part.type === "subagent") {
      for (const message of part.subagent.messages) yield* mediaParts(message.parts);
    }
  }
}

export function hasStoredMedia(parts: readonly MessagePart[]): boolean {
  for (const part of mediaParts(parts)) if (mediaBlobRef(part)) return true;
  return false;
}

async function extractMediaPart(chatId: string, part: MediaPart): Promise<MediaPart> {
  const dataUrl = mediaDataUrl(part);
  if (!dataUrl || !isDataUrl(dataUrl)) return part;
  const blob = dataUrlToBlob(dataUrl);
  const blobId = await storeChatBlob(chatId, blob);
  return {
    ...part,
    source: { type: "url", value: createBlobRef(blobId) },
    metadata: { ...mediaMetadata(part), contentType: blob.type || mediaMimeType(part) },
  } as MediaPart;
}

async function rehydrateMediaPart(chatId: string, part: MediaPart): Promise<MediaPart> {
  const blobId = mediaBlobRef(part);
  if (!blobId) return part;
  const blob = await getChatBlob(chatId, blobId);
  if (!blob) {
    // Preserve the reference so saving this chat cannot erase the information
    // needed to repair a partial restore later.
    console.warn(`Blob not found: ${blobId}`);
    return part;
  }
  // OPFS never persists the blob's MIME, so re-infer it from the stored type or
  // the file name, and let blobToDataUrl stamp it — never trust the `.bin` read-back.
  const metadata = mediaMetadata(part);
  const contentType =
    (metadata.contentType || lookupContentType(fileExtension(metadata.filename ?? ""))) ??
    (part.type === "image" ? "image/png" : part.type === "audio" ? "audio/wav" : undefined);
  const dataUrl = await blobToDataUrl(blob, contentType);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";")) || contentType || "application/octet-stream";
  return {
    ...part,
    source: { type: "data", value: base64, mimeType },
    metadata: { ...metadata, contentType: mimeType },
  } as MediaPart;
}

/** Transform media everywhere TanStack can carry it, preserving the rest of each native part. */
async function mapMediaParts<T extends MessagePart>(
  parts: readonly T[],
  transform: (part: MediaPart) => Promise<MediaPart>,
): Promise<T[]> {
  return finishBlobWrites(
    parts.map(async (part): Promise<T> => {
      if (isMediaPart(part)) return (await transform(part)) as T;
      if (part.type === "tool-result") {
        const result = toolResultMetadata(part).result;
        return {
          ...part,
          ...(Array.isArray(part.content) ? { content: await mapMediaParts(part.content, transform) } : {}),
          ...(result ? { metadata: { ...part.metadata, result: await mapMediaParts(result, transform) } } : {}),
        };
      }
      if (part.type === "subagent")
        return {
          ...part,
          subagent: { ...part.subagent, messages: await mapMessageMedia(part.subagent.messages, transform) },
        };
      return part;
    }),
  );
}

/** Content parts with their chat blobs loaded back into data. */
export function rehydrateContentParts<T extends MessagePart>(chatId: string, parts: readonly T[]): Promise<T[]> {
  return mapMediaParts(parts, (part) => rehydrateMediaPart(chatId, part));
}

function mapMessageMedia(
  messages: readonly UIMessage[],
  transform: (part: MediaPart) => Promise<MediaPart>,
): Promise<UIMessage[]> {
  return finishBlobWrites(
    messages.map(async (message) => ({ ...message, parts: await mapMediaParts(message.parts, transform) })),
  );
}

/** Never release the chat save lock while sibling blob writes are still active. */
async function finishBlobWrites<T>(writes: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(writes);
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

// ============================================================================
// Whole chats
// ============================================================================

function isoDate(value: Date | null): string | null {
  return value instanceof Date ? value.toISOString() : (value as unknown as string) || null;
}

/** Runtime state is kept only while it has content, so idle chats stay small. */
function runtimeFields({ resume, metadata }: Pick<Chat, "resume" | "metadata">) {
  return {
    ...(resume ? { resume } : {}),
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  };
}

/**
 * Extract all binary data from a chat and store as blobs in chat folder.
 * Returns a StoredChat suitable for JSON serialization.
 * Note: Artifacts should be saved separately via saveArtifacts().
 */
export async function extractChatBlobs(chat: Chat): Promise<StoredChat> {
  return {
    version: STORED_CHAT_VERSION,
    id: chat.id,
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    created: isoDate(chat.created),
    updated: isoDate(chat.updated),
    model: chat.model,
    messages: await mapMessageMedia(chat.messages, (part) => extractMediaPart(chat.id, part)),
    ...runtimeFields(chat),
  };
}

/** Restore dates and message identities without reading attachment bytes. */
export function restoreChatManifest(stored: StoredChat): Chat {
  const fallbackCreatedAt = stored.created ?? new Date(0).toISOString();
  return {
    ...runtimeFields(stored),
    id: stored.id,
    title: stored.title,
    customTitle: stored.customTitle,
    customIndex: stored.customIndex,
    model: stored.model,
    created: stored.created ? new Date(stored.created) : null,
    updated: stored.updated ? new Date(stored.updated) : null,
    messages: mapMessages(stored.messages, (message) => ({
      ...message,
      createdAt: new Date(message.createdAt ?? fallbackCreatedAt),
    })),
  };
}

/**
 * Rehydrate all blob references in a stored chat.
 * Returns a Chat with all media restored as data.
 * Note: Artifacts should be loaded separately via loadArtifacts().
 */
export async function rehydrateChatBlobs(stored: StoredChat): Promise<Chat> {
  const chat = restoreChatManifest(stored);
  return { ...chat, messages: await mapMessageMedia(chat.messages, (part) => rehydrateMediaPart(stored.id, part)) };
}

/**
 * Collect all blob IDs referenced in a stored chat.
 */
export function collectChatBlobIds(chat: Pick<StoredChat, "messages">): string[] {
  const ids: string[] = [];
  for (const message of chat.messages) {
    for (const part of mediaParts(message.parts)) {
      const blobId = mediaBlobRef(part);
      if (blobId) ids.push(blobId);
    }
  }
  return ids;
}

/** Remove only blobs no longer referenced by a persisted manifest or its recovery record. */
export async function deleteUnreferencedChatBlobs(
  chat: StoredChat,
  retainedBlobIds: readonly string[] = [],
): Promise<void> {
  const referenced = new Set([...collectChatBlobIds(chat), ...retainedBlobIds]);
  const stored = await listChatBlobs(chat.id);
  await Promise.all(
    stored.filter((blobId) => !referenced.has(blobId)).map((blobId) => deleteChatBlob(chat.id, blobId)),
  );
}
