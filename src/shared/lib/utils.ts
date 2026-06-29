import mime from "mime";
import type { AudioContent, FileContent, ImageContent, TextContent } from "@/shared/types/chat";

// Parse a data URL to extract mimeType and base64 data
export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

/**
 * Serialize tool result content for API transmission.
 * Strips binary data (images, audio, files) and replaces with text descriptions
 * to avoid sending large base64 data URLs to the model which it cannot process.
 */
export function serializeToolResultForApi(result: (TextContent | ImageContent | AudioContent | FileContent)[]): string {
  const serialized = result.map((item) => {
    if (item.type === "text") {
      return item;
    }
    if (item.type === "image") {
      return {
        type: "text",
        text: `[Image${item.name ? `: ${item.name}` : ""} - displayed to user]`,
      };
    }
    if (item.type === "audio") {
      return {
        type: "text",
        text: `[Audio${item.name ? `: ${item.name}` : ""} - displayed to user]`,
      };
    }
    if (item.type === "file") {
      return {
        type: "text",
        text: `[File: ${item.name} - displayed to user]`,
      };
    }
    return item;
  });
  return JSON.stringify(serialized);
}

export function lookupContentType(ext: string): string | undefined {
  const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
  return mime.getType(normalizedExt) ?? undefined;
}

export function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const base64String = reader.result as string;
      resolve(base64String);
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsDataURL(blob);
  });
}

export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  // Native path (Safari 18.2+, Edge/Chrome 140+) — skips the intermediate
  // binary string entirely.
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
  if (typeof fromBase64 === "function") {
    return fromBase64(base64);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeDataURL(dataURL: string): Blob {
  const [header, base64] = dataURL.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
  return new Blob([decodeBase64(base64)], { type: mimeType });
}

export async function resizeImageBlob(blob: Blob, maxWidth: number, maxHeight: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(img.src);

      let newWidth = img.width;
      let newHeight = img.height;

      if (newWidth > maxWidth) {
        newHeight = Math.round((maxWidth * newHeight) / newWidth);
        newWidth = maxWidth;
      }

      if (newHeight > maxHeight) {
        newWidth = Math.round((maxHeight * newWidth) / newHeight);
        newHeight = maxHeight;
      }

      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Use blob's type if it's a valid image MIME, otherwise default to PNG
      const outputType = blob.type?.startsWith("image/") ? blob.type : "image/png";

      canvas.toBlob(
        (resizedBlob) => {
          if (resizedBlob) {
            resolve(resizedBlob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        },
        outputType,
        0.9,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
  });
}

export function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

/** Lowercase file extension without the leading dot, or "" if there is none. */
export function fileExtension(pathOrName: string): string {
  const name = getFileName(pathOrName);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function getToolDisplayName(toolName: string): string {
  return toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function downloadFromUrl(url: string, filename: string = ""): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || filenameFromUrl(url);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, filename);
  URL.revokeObjectURL(url);
}

// Internal to downloadFromUrl — derives a filename for data URLs. Not exported.
function filenameFromUrl(src: string): string {
  // If it's a data URL, extract the MIME type and derive a simple filename
  if (src.startsWith("data:")) {
    const mimeMatch = src.match(/^data:([^;]+)[;,]/);
    if (mimeMatch) {
      const mimeType = mimeMatch[1];
      const ext = mime.getExtension(mimeType);
      if (ext) {
        const base = mimeType.startsWith("image/") ? "image" : "file";
        const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
        return `${base}.${cleanExt}`;
      }
    }
    // No recognized extension
    return "";
  }
  // For non-data URLs, don't attempt to infer; let the browser decide
  return "";
}

export function simplifyMarkdown(content: string): string {
  // Remove markdown images: ![alt](url) or ![alt][ref]
  content = content.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  content = content.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");

  // Remove HTML img tags
  content = content.replace(/<img[^>]*>/gi, "");

  // Remove data URLs (base64 embedded content)
  content = content.replace(/data:[a-zA-Z0-9]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[data-url]");

  // Remove other embedded data URLs (non-base64)
  content = content.replace(/data:[a-zA-Z0-9]+\/[a-zA-Z0-9.+-]+,[^\s)"']+/g, "[data-url]");

  // Remove SVG content (often very long)
  content = content.replace(/<svg[\s\S]*?<\/svg>/gi, "[svg]");

  // Remove style blocks
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Remove script blocks
  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");

  // Remove HTML comments
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  // Remove long hex color codes or hashes (more than 32 chars)
  content = content.replace(/[a-f0-9]{32,}/gi, "[hash]");

  // Collapse multiple consecutive blank lines into one
  content = content.replace(/\n{3,}/g, "\n\n");

  // Trim whitespace
  content = content.trim();

  return content;
}
