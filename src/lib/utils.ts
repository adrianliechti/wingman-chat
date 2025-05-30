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

export function supportsScreenshot(): boolean {
  return "mediaDevices" in navigator && "getDisplayMedia" in navigator.mediaDevices;
}

export async function captureScreenshot(): Promise<string> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve(null);
      };
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

    stream.getTracks().forEach((track) => track.stop());

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Error capturing screenshot:", err);
    throw err;
  }
}

export function getFileExt(filename: string): string {
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

export const partitionTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const supportedTypes = [...textTypes, ...imageTypes, ...partitionTypes];

export interface DetectedURL {
  url: string;
  text: string;
  type: 'markdown' | 'plain';
}

export function detectURLs(text: string): DetectedURL[] {
  const urls: DetectedURL[] = [];
  
  // Detect markdown links [text](url) - including footnote style
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const [, linkText, url] = match;
    if (isValidURL(url)) {
      urls.push({
        url: normalizeURL(url),
        text: linkText.trim(),
        type: 'markdown'
      });
    }
  }
  
  // Detect plain URLs (not already captured in markdown links)
  // More comprehensive regex to capture URLs without protocols
  const plainURLRegex = /(?<!]\()(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s)]*)?/g;
  
  while ((match = plainURLRegex.exec(text)) !== null) {
    const url = match[0];
    if (isValidURL(url) || isValidDomain(url)) {
      const normalizedURL = normalizeURL(url);
      // Avoid duplicates from markdown links
      if (!urls.some(u => u.url === normalizedURL)) {
        urls.push({
          url: normalizedURL,
          text: url,
          type: 'plain'
        });
      }
    }
  }
  
  // Remove duplicates based on URL
  const seen = new Set();
  return urls.filter(url => {
    const key = url.url;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isValidURL(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

function isValidDomain(domain: string): boolean {
  // Simple domain validation
  const domainRegex = /^(?:(?:www\.)?[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}

function normalizeURL(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}