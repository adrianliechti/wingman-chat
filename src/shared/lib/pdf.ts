import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
// Use the bundled worker via URL import so Vite includes it in the build.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFPageProxy, TextContent } from "pdfjs-dist/types/src/display/api";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Converts a PDF file to Markdown using pdf.js text extraction.
 *
 * Heuristics:
 * - Font size relative to the page median determines heading level.
 * - Consecutive text items on the same line are merged.
 * - Line breaks within a paragraph are collapsed; blank gaps produce a new block.
 * - Bullet-like prefixes (•, -, *, numbered) are preserved.
 */
export async function pdfToMarkdown(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer, useSystemFonts: true }).promise;

  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await readTextContent(page);
    const items = content.items.filter((it): it is TextItem => "str" in it);

    if (items.length === 0) continue;

    const lines = groupIntoLines(items);
    const medianFontSize = computeMedianFontSize(items);
    const md = renderLines(lines, medianFontSize);
    if (md) pages.push(md);
  }

  return pages.join("\n\n---\n\n");
}

// ============================================================================
// ReadableStream polyfill for getTextContent
// Safari and some browsers don't support async iteration on ReadableStream,
// which pdfjs-dist v5 uses internally. Use the reader API instead.
// ============================================================================

async function readTextContent(page: PDFPageProxy): Promise<TextContent> {
  const stream = page.streamTextContent();
  const reader = stream.getReader();
  const textContent: TextContent = { items: [], styles: Object.create(null), lang: null };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    textContent.lang ??= value.lang;
    Object.assign(textContent.styles, value.styles);
    textContent.items.push(...value.items);
  }

  return textContent;
}

// ============================================================================
// Internal types
// ============================================================================

interface Line {
  y: number;
  fontSize: number;
  items: TextItem[];
}

// ============================================================================
// Grouping text items into lines
// ============================================================================

function groupIntoLines(items: TextItem[]): Line[] {
  if (items.length === 0) return [];

  const lines: Line[] = [];
  let currentLine: Line | null = null;

  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;

    const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]);
    const y = item.transform[5];

    // Start a new line if y position differs enough from the current line.
    if (!currentLine || Math.abs(y - currentLine.y) > fontSize * 0.3) {
      currentLine = { y, fontSize, items: [] };
      lines.push(currentLine);
    }

    // Track the largest font size on this line
    if (fontSize > currentLine.fontSize) {
      currentLine.fontSize = fontSize;
    }

    currentLine.items.push(item);
  }

  return lines;
}

// ============================================================================
// Rendering lines to Markdown
// ============================================================================

function renderLines(lines: Line[], medianFontSize: number): string {
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let lastY = Number.POSITIVE_INFINITY;
  let lastFontSize = medianFontSize;

  for (const line of lines) {
    const text = line.items
      .map((it) => it.str)
      .join("")
      .trim();
    if (!text) {
      // Empty line → flush block
      flushBlock(blocks, currentBlock);
      currentBlock = [];
      lastY = Number.POSITIVE_INFINITY;
      continue;
    }

    // Detect large vertical gap (> 1.8× font height) as paragraph break
    const gap = Math.abs(lastY - line.y);
    const isNewParagraph = gap > lastFontSize * 1.8 && currentBlock.length > 0;

    if (isNewParagraph) {
      flushBlock(blocks, currentBlock);
      currentBlock = [];
    }

    const headingLevel = detectHeading(line.fontSize, medianFontSize);
    if (headingLevel > 0 && headingLevel <= 6) {
      // Headings always start a new block
      flushBlock(blocks, currentBlock);
      currentBlock = [];
      blocks.push(`${"#".repeat(headingLevel)} ${escapeMarkdown(text)}`);
    } else {
      currentBlock.push(escapeMarkdown(text));
    }

    lastY = line.y;
    lastFontSize = line.fontSize;
  }

  flushBlock(blocks, currentBlock);

  return blocks.join("\n\n");
}

function flushBlock(blocks: string[], lines: string[]): void {
  if (lines.length === 0) return;

  // Check if this looks like a list (most lines start with a bullet/number)
  const isList = lines.length > 1 && lines.filter(isBulletLine).length > lines.length * 0.5;

  if (isList) {
    blocks.push(lines.join("\n"));
  } else {
    blocks.push(lines.join(" "));
  }
}

// ============================================================================
// Heading detection
// ============================================================================

function detectHeading(fontSize: number, medianFontSize: number): number {
  if (medianFontSize <= 0) return 0;
  const ratio = fontSize / medianFontSize;

  if (ratio >= 2.0) return 1;
  if (ratio >= 1.6) return 2;
  if (ratio >= 1.3) return 3;
  return 0;
}

// ============================================================================
// Helpers
// ============================================================================

const BULLET_RE = /^(\s*[-•*●◦▪]\s|(?:\d+[.)]\s))/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line);
}

function computeMedianFontSize(items: TextItem[]): number {
  const sizes = items.map((it) => Math.abs(it.transform[3]) || Math.abs(it.transform[0])).filter((s) => s > 0);

  if (sizes.length === 0) return 12;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

function escapeMarkdown(text: string): string {
  // Only escape characters that could produce accidental Markdown formatting.
  // Preserve bullet-like prefixes and numbered list prefixes.
  if (BULLET_RE.test(text)) return text;
  return text.replace(/([\\*_`[\]<>~#|])/g, "\\$1").replace(/^(\d+)\./gm, "$1\\.");
}
