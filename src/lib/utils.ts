import mime from 'mime';

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

export function stripMarkdown(text: string): string {
  if (!text) return '';
  
  return text
    // Remove headers but add spacing (2 lines before, 1 after)
    .replace(/^#{1,6}\s+(.+)$/gm, '\n\n$1\n')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove malformed code blocks (double backticks)
    .replace(/``[\w]*\n?([\s\S]*?)``/g, (_, code) => {
      const cleanCode = code.trim();
      return `\n\n${cleanCode}\n\n`;
    })
    // Remove code blocks but keep content with spacing
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
      const cleanCode = code.trim();
      return `\n\n${cleanCode}\n\n`;
    })
    // Remove any remaining single backticks (malformed inline code)
    .replace(/`/g, '')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Remove blockquotes but keep indentation
    .replace(/^>\s+/gm, '  ')
    // Convert unordered list markers to bullet points
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    // Convert numbered lists to numbered format
    .replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
    // Clean up extra whitespace (but preserve intentional spacing)
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+/, '')
    .trim();
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
  return downloadFromUrl(URL.createObjectURL(blob), filename);
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