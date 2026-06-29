import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
// Use the bundled worker via URL import so Vite includes it in the build.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFPageProxy, TextContent, TextItem } from "pdfjs-dist/types/src/display/api";

GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js fetches WebAssembly image decoders (openjpeg.wasm for JPEG2000, jbig2.wasm
// for JBIG2), ICC color profiles, predefined CMaps, and standard fonts at runtime by
// exact filename. Scanned PDFs in particular rely on the wasm decoders, so without
// these URLs their pages render blank or garbled. The folders are served verbatim
// from /pdfjs/* by the pdfjsAssetsPlugin in vite.config.ts.
const pdfAssetBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}pdfjs/`;

/** Shared pdf.js asset URLs to pass into getDocument(). */
export const pdfAssetOptions = {
  wasmUrl: `${pdfAssetBase}wasm/`,
  iccUrl: `${pdfAssetBase}iccs/`,
  cMapUrl: `${pdfAssetBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${pdfAssetBase}standard_fonts/`,
} as const;

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
  const pdf = await getDocument({ data: buffer, useSystemFonts: true, ...pdfAssetOptions }).promise;

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

// ============================================================================
// Rasterization (PDF pages → PNG)
// ============================================================================

export interface RasterizedPage {
  /** 1-based page number. */
  page: number;
  /** PNG-encoded page image. */
  data: Uint8Array;
}

export interface RasterizeOptions {
  /** 1-based page numbers to render; omitted or empty renders every page. */
  pages?: number[];
  /** Viewport scale; 1 ≈ 72 DPI. Defaults to 2 (≈144 DPI), clamped to 8. */
  scale?: number;
}

/**
 * Rasterizes PDF pages to PNG bytes with pdf.js. The sandbox runtimes have no
 * in-process PDF rasterizer (pypdfium2/PyMuPDF/poppler are all absent), so the
 * Python `rasterize_pdf` and JS `rasterizePdf` helpers reach this over the
 * worker→main bridge. Must run on the main thread — it renders to a DOM canvas.
 */
export async function rasterizePdf(bytes: Uint8Array, options?: RasterizeOptions): Promise<RasterizedPage[]> {
  // Clamp the upper bound: this renders on the main thread, and an oversized
  // canvas silently yields a blank image (or throws) past browser limits.
  const scale = Math.min(options?.scale && options.scale > 0 ? options.scale : 2, 8);
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true, ...pdfAssetOptions });
  const pdf = await loadingTask.promise;
  try {
    const requested =
      options?.pages && options.pages.length > 0
        ? options.pages.filter((n) => Number.isInteger(n) && n >= 1 && n <= pdf.numPages)
        : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    // De-dup while preserving the caller's order.
    const wanted = [...new Set(requested)];
    if (wanted.length === 0) {
      throw new Error(
        `rasterize_pdf: no valid pages in ${JSON.stringify(options?.pages)} (document has ${pdf.numPages} page(s))`,
      );
    }

    const pages: RasterizedPage[] = [];
    for (const n of wanted) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("rasterize_pdf: 2D canvas context unavailable");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      pages.push({ page: n, data: await canvasToPng(canvas) });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("rasterize_pdf: canvas.toBlob produced no image"));
        return;
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, "image/png");
  });
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
