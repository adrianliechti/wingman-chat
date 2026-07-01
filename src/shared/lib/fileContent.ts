/**
 * File content encoding helpers.
 *
 * Content in a `File` is either UTF-8 text or a `data:` URL for binary
 * payloads. These helpers convert between those representations and
 * bytes/blobs/base64 without any feature-specific assumptions.
 */

import type { File } from "@/shared/types/file";
import { decodeBase64, parseDataUrl } from "./utils";

export function isDataUrl(content: string): boolean {
  return content.startsWith("data:");
}

export function encodeBase64(bytes: Uint8Array): string {
  // Native path (Safari 18.2+, Edge/Chrome 140+) — by far the fastest and
  // avoids materializing an intermediate binary string.
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") {
    return native.call(bytes);
  }

  // Fallback for older browsers: convert in chunks. Per-byte string
  // concatenation is pathologically slow for multi-MB payloads;
  // String.fromCharCode over subarrays stays linear while keeping the
  // argument count well under engine limits.
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(""));
}

export function dataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return null;
  }
  return {
    mimeType: parsed.mimeType,
    bytes: decodeBase64(parsed.data),
  };
}

export function bytesToDataUrl(bytes: Uint8Array, contentType: string = "application/octet-stream"): string {
  return `data:${contentType};base64,${encodeBase64(bytes)}`;
}

export function textToDataUrl(content: string, contentType: string = "text/plain;charset=utf-8"): string {
  return bytesToDataUrl(new TextEncoder().encode(content), contentType);
}

/**
 * Turn a `File`'s content into a `Blob`. If content is a data URL, the
 * embedded MIME type wins; otherwise `contentType` (or a text fallback)
 * is used.
 */
export function contentToBlob(content: string, contentType?: string): Blob {
  const parsed = dataUrlToBytes(content);
  if (parsed) {
    return new Blob([new Uint8Array(parsed.bytes)], { type: parsed.mimeType });
  }
  return new Blob([content], { type: contentType ?? "text/plain;charset=utf-8" });
}

/**
 * Turn a file's content into a value suitable for `JSZip.file(path, value)`.
 * Binary payloads become `Uint8Array`; text stays a string, with a UTF-8 BOM
 * prepended for CSV/TSV so Excel detects the encoding correctly.
 */
export function contentToZipValue(file: Pick<File, "content" | "contentType">): string | Uint8Array {
  const parsed = dataUrlToBytes(file.content);
  if (parsed) {
    return parsed.bytes;
  }

  const ct = file.contentType?.toLowerCase();
  if (ct === "text/csv" || ct === "text/tab-separated-values") {
    return new TextEncoder().encode(`\uFEFF${file.content}`);
  }

  return file.content;
}
