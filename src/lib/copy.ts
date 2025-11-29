import { markdownToHtml, markdownToText } from "./utils";

export interface CopyOptions {
  text: string;
}

export async function copyToClipboard(options: CopyOptions): Promise<void> {
  const { text } = options;

  if (!text) {
    return;
  }

  const clipboardData: Record<string, Blob> = {};
  const format = detectFormat(text);

  if (format === 'html') {
    clipboardData['text/html'] = new Blob([text], { type: 'text/html' });
  } else if (format === 'markdown') {
    // clipboardData['text/markdown'] = new Blob([text], { type: 'text/markdown' });
    clipboardData['text/plain'] = new Blob([markdownToText(text)], { type: 'text/plain' });
    clipboardData['text/html'] = new Blob([markdownToHtml(text)], { type: 'text/html' });
  } else {
    clipboardData['text/plain'] = new Blob([text], { type: 'text/plain' });
  }

  const clipboardItem = new ClipboardItem(clipboardData);
  await navigator.clipboard.write([clipboardItem]);
}

function detectFormat(text: string): 'html' | 'markdown' | 'plain' {
  const trimmed = text.trim();
  
  // Detect HTML
  if (trimmed.startsWith('<!DOCTYPE') || 
      trimmed.startsWith('<html') || 
      (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.includes('</'))) {
    return 'html';
  }
  
  // Detect Markdown (common patterns)
  const markdownPatterns = [
    /^#{1,6}\s/m,           // Headers
    /\*\*.*\*\*/,           // Bold
    /\*.*\*/,               // Italic
    /\[.*\]\(.*\)/,         // Links
    /!\[.*\]\(.*\)/,        // Images
    /^[-*+]\s/m,            // Unordered lists
    /^\d+\.\s/m,            // Ordered lists
    /^>\s/m,                // Blockquotes
    /```/,                  // Code blocks
    /`[^`]+`/,              // Inline code
    /^\|.+\|$/m,            // Tables (lines with pipes)
    /^\|[-:| ]+\|$/m,       // Table separator rows
    /^[-*_]{3,}$/m,         // Horizontal rules
    /~~.+~~/,               // Strikethrough
    /^\s*[-*+] \[[ x]\]/m,  // Task lists
    /\[\^[^\]]+\]/,         // Footnote references [^1]
    /^\[\^[^\]]+\]:/m,      // Footnote definitions [^1]:
    /^={3,}$/m,             // Setext heading (===)
    /^-{3,}$/m,             // Setext heading (---) - also HR
  ];
  
  if (markdownPatterns.some(pattern => pattern.test(text))) {
    return 'markdown';
  }
  
  return 'plain';
}
