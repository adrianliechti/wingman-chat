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
    clipboardData["text/html"] = new Blob([html], { type: "text/html" });
  } else if (markdown) {
    // Markdown: copy as plain text + html. Both converters live in
    // markdownConvert (markdownToHtml pulls in `marked`), loaded on demand here
    // rather than shipped in the initial bundle.
    const { markdownToHtml, markdownToText } = await import("./markdownConvert");
    clipboardData["text/plain"] = new Blob([markdownToText(markdown)], { type: "text/plain" });
    clipboardData["text/html"] = new Blob([markdownToHtml(markdown)], { type: "text/html" });
  } else if (text) {
    // Plain text: copy as text only
    clipboardData["text/plain"] = new Blob([text], { type: "text/plain" });
  } else {
    return;
  }

  try {
    const clipboardItem = new ClipboardItem(clipboardData);
    await navigator.clipboard.write([clipboardItem]);
  } catch {
    // Fallback for environments where ClipboardItem write fails (e.g. document not focused)
    const fallback = text || markdown || html || "";
    await navigator.clipboard.writeText(fallback);
  }
}
