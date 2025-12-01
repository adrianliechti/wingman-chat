import { markdownToHtml, markdownToText } from "./utils";

export interface CopyOptions {
  text?: string;
  markdown?: string;
  html?: string;
}

export async function copyToClipboard(options: CopyOptions): Promise<void> {
  const { text, markdown, html } = options;

  const clipboardData: Record<string, Blob> = {};

  if (html) {
    // HTML: copy as html only
    clipboardData['text/html'] = new Blob([html], { type: 'text/html' });
  } else if (markdown) {
    // Markdown: copy as plain text + html
    clipboardData['text/plain'] = new Blob([markdownToText(markdown)], { type: 'text/plain' });
    clipboardData['text/html'] = new Blob([markdownToHtml(markdown)], { type: 'text/html' });
  } else if (text) {
    // Plain text: copy as text only
    clipboardData['text/plain'] = new Blob([text], { type: 'text/plain' });
  } else {
    return;
  }

  const clipboardItem = new ClipboardItem(clipboardData);
  await navigator.clipboard.write([clipboardItem]);
}
