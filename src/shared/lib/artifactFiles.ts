import { parseDataUrl } from './utils';

export interface ArtifactContent {
  content: string;
  contentType?: string;
}

export function normalizeArtifactPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  let normalized = path.trim();
  if (!normalized) {
    return undefined;
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/+/g, '/');

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function normalizeArtifactReferencePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\//, '');
}

export function isDataUrlContent(content: string): boolean {
  return content.startsWith('data:');
}

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binaryString = '';

  for (const byte of bytes) {
    binaryString += String.fromCharCode(byte);
  }

  return btoa(binaryString);
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

export function bytesToDataUrl(bytes: Uint8Array, contentType: string = 'application/octet-stream'): string {
  return `data:${contentType};base64,${encodeBase64(bytes)}`;
}

export function textToDataUrl(content: string, contentType: string = 'text/plain;charset=utf-8'): string {
  return bytesToDataUrl(new TextEncoder().encode(content), contentType);
}

export function artifactContentToBlob(content: string, contentType?: string): Blob {
  const parsed = dataUrlToBytes(content);
  if (parsed) {
    return new Blob([new Uint8Array(parsed.bytes)], { type: parsed.mimeType });
  }

  return new Blob([content], { type: contentType ?? 'text/plain;charset=utf-8' });
}

export function artifactContentToZipValue(file: ArtifactContent): string | Uint8Array {
  const parsed = dataUrlToBytes(file.content);
  if (parsed) {
    return parsed.bytes;
  }

  return file.content;
}
