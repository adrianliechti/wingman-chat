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

/** Return decoded bytes without allocating the decoded payload. */
export function dataUrlDecodedByteLength(dataUrl: string): number | null {
  if (!dataUrl.startsWith("data:")) return null;
  const marker = ";base64,";
  const markerIndex = dataUrl.indexOf(marker, 5);
  if (markerIndex <= 5 || dataUrl.indexOf(";", 5) !== markerIndex) return null;

  const dataStart = markerIndex + marker.length;
  const base64Length = dataUrl.length - dataStart;
  if (base64Length === 0 || base64Length % 4 === 1) return null;

  let padding = 0;
  if (dataUrl.endsWith("=")) padding++;
  if (dataUrl.endsWith("==")) padding++;
  if (padding > 0 && base64Length % 4 !== 0) return null;

  const contentEnd = dataUrl.length - padding;
  for (let index = dataStart; index < contentEnd; index++) {
    const code = dataUrl.charCodeAt(index);
    const isBase64 =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!isBase64) return null;
  }
  for (let index = contentEnd; index < dataUrl.length; index++) {
    if (dataUrl.charCodeAt(index) !== 61) return null;
  }

  const completeGroups = Math.floor(base64Length / 4);
  const remainder = base64Length % 4;
  return completeGroups * 3 - padding + (remainder === 2 ? 1 : remainder === 3 ? 2 : 0);
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

export function dataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array<ArrayBuffer> } | null {
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
