import { getConfig } from "@/shared/config";
import { docxToMarkdown } from "./docx";
import { inferContentTypeFromPath, isTextContentType } from "./fileTypes";
import { pdfToMarkdown } from "./pdf";
import { pptxToMarkdown } from "./pptx";
import { xlsxToCsv } from "./xlsx";

// MIME constants
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** All file types the converter supports — used for file-picker accept filters. */
export const SUPPORTED_TYPES = [
  // Text / code
  ".csv",
  "text/csv",
  ".md",
  "text/markdown",
  ".txt",
  "text/plain",
  ".json",
  "application/json",
  ".sql",
  "application/sql",
  ".toml",
  "application/toml",
  ".yaml",
  ".yml",
  "application/x-yaml",
  "text/yaml",
  ".xml",
  "application/xml",
  "text/xml",
  ".css",
  "text/css",
  ".html",
  "text/html",
  ".c",
  ".cpp",
  ".cs",
  ".dart",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".lua",
  ".php",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".scala",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",

  // Office documents & PDF
  ".docx",
  MIME_DOCX,
  ".xlsx",
  MIME_XLSX,
  ".pptx",
  MIME_PPTX,
  ".pdf",
  "application/pdf",

  // Images — stored verbatim as binary sources (not converted to text).
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

type ConverterKind = "text" | "builtin" | "backend" | null;

function converterKind(file: File, textTypes?: string[], extraTypes?: string[]): ConverterKind {
  const name = file.name.toLowerCase();
  const type = file.type;

  if (name.endsWith(".docx") || type === MIME_DOCX) return "builtin";
  if (name.endsWith(".xlsx") || type === MIME_XLSX) return "builtin";
  if (name.endsWith(".pptx") || type === MIME_PPTX) return "builtin";
  if (name.endsWith(".pdf") || type === "application/pdf") return "builtin";

  if (isTextContentType(type || inferContentTypeFromPath(name))) return "text";

  if (textTypes?.some((t) => (t.startsWith(".") ? name.endsWith(t) : type === t))) return "text";

  if (extraTypes?.some((t) => (t.startsWith(".") ? name.endsWith(t) : type === t))) return "backend";

  return null;
}

/** Whether this module can convert the given file (includes extra types from config). */
export function canConvert(file: File): boolean {
  // Images are handled by the caller (stored verbatim as binary sources),
  // but we advertise them as accepted so the picker lets them through.
  if (file.type.startsWith("image/")) return true;
  const config = getConfig();
  return converterKind(file, config.text?.files, config.extractor?.files) !== null;
}

/** All accepted file types (SUPPORTED_TYPES + text files + extractor files from config). */
export function acceptTypes(): string[] {
  const config = getConfig();
  return [...SUPPORTED_TYPES, ...(config.text?.files ?? []), ...(config.extractor?.files ?? [])];
}

/**
 * Convert a file to text (Markdown or CSV).
 *
 * Built-in converters handle DOCX, XLSX, PPTX, PDF, and text files.
 * The backend extractor (via config) is tried first for non-text types (it may
 * produce better results). If it fails, built-in converters are used as
 * fallback. For extra types configured in `extractor.files` (e.g. .msg, .eml)
 * the backend is the only path.
 */
export async function convertFileToText(file: File): Promise<string> {
  const config = getConfig();
  const kind = converterKind(file, config.text?.files, config.extractor?.files);

  // Try API extraction first for non-text builtin types
  if (config.extractor && kind === "builtin") {
    try {
      const text = await config.client.extractText(file);
      if (text?.trim()) return text;
    } catch {
      // fall through to client-side converter
    }
  }

  // Backend-only types → extractText is the only path
  if (kind === "backend") {
    return config.client.extractText(file);
  }

  // Built-in converters
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || file.type === MIME_XLSX) {
    const results = await xlsxToCsv(file);
    if (results.length === 1) return results[0].csv;
    return results.map((r) => `## ${r.sheetName}\n\n${r.csv}`).join("\n\n");
  }

  if (name.endsWith(".docx") || file.type === MIME_DOCX) {
    return docxToMarkdown(file);
  }

  if (name.endsWith(".pptx") || file.type === MIME_PPTX) {
    return pptxToMarkdown(file);
  }

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return pdfToMarkdown(file);
  }

  // Text files → read with encoding detection
  return readFileAsText(file);
}

/** Read a File as text, detecting encoding (BOM → UTF-8 → Windows-1252 fallback). */
export async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }

  // Try UTF-8 (strict) — fails on invalid sequences
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Fall back to Windows-1252 (superset of ISO-8859-1, handles all European accented chars)
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
