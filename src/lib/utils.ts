import mime from 'mime';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { AttachmentType } from '../types/chat';
import type { Attachment, Content } from '../types/chat';

export function lookupContentType(ext: string): string {
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return mime.getType(normalizedExt) || 'application/octet-stream';
}

export function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const text = reader.result as string;
      resolve(text);
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsText(blob);
  });
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

export function decodeDataURL(dataURL: string): Blob {
  const [header, base64] = dataURL.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export async function resizeImageBlob(
  blob: Blob,
  maxWidth: number,
  maxHeight: number
): Promise<Blob> {
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

      canvas.toBlob(
        (resizedBlob) => {
          if (resizedBlob) {
            resolve(resizedBlob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        },
        blob.type,
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
  });
}

export function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function getFileExt(path: string): string {
  const filename = getFileName(path);
  const parts = filename.split('.');
  return parts.length > 1 ? "." + parts.pop() || "" : "";
}

export const textTypes = [
  "text/csv",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/sql",
  "application/toml",
  "application/x-yaml",
  "application/xml",
  "text/css",
  "text/html",
  "text/xml",
  "text/yaml",
  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".html",
  ".java",
  ".js",
  ".kt",
  ".py",
  ".rs",
  ".ts",
];

export const imageTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export const documentTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".msg",
  ".eml",
];

export const supportedTypes = [...textTypes, ...imageTypes, ...documentTypes];

export function isAudioUrl(url: string): boolean {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    // Check file extensions
    return audioExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function isVideoUrl(url: string): boolean {
  const videoExtensions = ['.mp4', '.webm', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    // Check file extensions
    return videoExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';
  
  try {
    const result = unified()
      .use(remarkParse)        // Parse markdown
      .use(remarkGfm)          // Support tables, strikethrough, task lists, etc.
      .use(remarkRehype, { allowDangerousHtml: true })       // Convert to HTML with raw HTML support
      .use(rehypeStringify, { allowDangerousHtml: true })    // Stringify to HTML
      .processSync(markdown);
    
    let html = String(result);
    
    // Add Word-compatible styling for tables
    html = html
      .replace(/<table>/g, '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse: collapse; border: 1px solid black;">')
      .replace(/<td>/g, '<td style="border: 1px solid black; padding: 4px;">')
      .replace(/<th>/g, '<th style="border: 1px solid black; padding: 4px; font-weight: bold;">');
    
    return html;
  } catch (error) {
    console.error('Failed to convert markdown to HTML:', error);
    return markdown;
  }
}

export function markdownToText(markdown: string): string {
  if (!markdown) return '';

  const escapeHtml = (text: string) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const unescapeHtml = (text: string) => text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  // Simple markdown patterns to plain text
  const text = markdown
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Headers - just the text with double newline
    .replace(/^#{1,6}\s+(.+)$/gm, '$1\n')
    // Bold/italic - keep text only
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Strikethrough
    .replace(/~~(.*?)~~/g, '$1')
    // Code blocks - keep content with escaping
    .replace(/```[\s\S]*?\n([\s\S]*?)```/g, (_, code) => escapeHtml(code.trim()) + '\n\n')
    .replace(/`([^`]+)`/g, (_, code) => escapeHtml(code))
    // Links - keep text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    // Images - keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Lists - keep items with newlines
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Blockquotes
    .replace(/^\s*>\s+/gm, '')
    // Horizontal rules
    .replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '')
    // Tables - preserve structure roughly
    .replace(/\|/g, ' ')
    .replace(/^[\s]*:?-+:?[\s]*$/gm, '')
    // Multiple blank lines to double newline
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();

  return unescapeHtml(text);
}

export function downloadFromUrl(url: string, filename: string = ''): void {
  const link = document.createElement('a');
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

export function filenameFromUrl(src: string): string {
  // If it's a data URL, extract the MIME type and derive a simple filename
  if (src.startsWith('data:')) {
    const mimeMatch = src.match(/^data:([^;]+)[;,]/);
    if (mimeMatch) {
      const mimeType = mimeMatch[1];
      const ext = mime.getExtension(mimeType);
      if (ext) {
        const base = mimeType.startsWith('image/') ? 'image' : 'file';
        const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
        return `${base}.${cleanExt}`;
      }
    }
    // No recognized extension
    return '';
  }
  // For non-data URLs, don't attempt to infer; let the browser decide
  return '';
}

export function contentToAttachments(contents: string | Content[]): Attachment[] {
  if (typeof contents === 'string') {
    return [];
  }

  const attachments: Attachment[] = [];

  for (const content of contents) {
    switch (content.type) {
      case 'image': {
        const ext = mime.getExtension(content.mimeType) || 'png';
        const mimeType = content.mimeType || 'image/png';
        attachments.push({
          type: AttachmentType.Image,
          name: `image.${ext}`,
          data: `data:${mimeType};base64,${content.data}`,
        });
        break;
      }
      
      case 'audio': {
        const ext = mime.getExtension(content.mimeType) || 'mp3';
        const mimeType = content.mimeType || 'audio/mpeg';
        attachments.push({
          type: AttachmentType.File,
          name: `audio.${ext}`,
          data: `data:${mimeType};base64,${content.data}`,
        });
        break;
      }
    }
  }

  return attachments;
}