import { getConfig } from "@/shared/config";
import { docxToMarkdown } from "./docx";
import { fileMatchesTypeList, inferContentTypeFromPath, isTextContentType } from "./fileTypes";
import { pdfToMarkdown } from "./pdf";
import { pptxToMarkdown } from "./pptx";
import { formatBytes } from "./utils";
import { csvToMarkdownTable, xlsxToCsv } from "./xlsx";

// MIME constants
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** All file types the converter supports — used for file-picker accept filters. */
export const SUPPORTED_TYPES = [
  // Any text MIME the browser reports — covers the bulk of text/data/code files
  // directly. Extensions below catch files the browser mislabels as binary.
  "text/*",

  // Text / data extensions
  ".txt",
  ".text",
  ".log",
  ".md",
  ".markdown",
  ".rst",
  ".csv",
  ".tsv",
  ".json",
  ".jsonc",
  ".json5",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".env",
  ".properties",
  ".sql",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".html",
  ".htm",
  ".tex",

  // Code extensions
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hh",
  ".hxx",
  ".cs",
  ".m",
  ".mm",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".sc",
  ".go",
  ".rs",
  ".swift",
  ".dart",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".py",
  ".rb",
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".jl",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".groovy",
  ".gradle",
  ".clj",
  ".cljs",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".ml",
  ".fs",
  ".vb",
  ".lisp",
  ".scm",
  ".rkt",
  ".nim",
  ".zig",
  ".v",
  ".sv",
  ".vhd",
  ".vhdl",
  ".asm",
  ".s",
  ".f",
  ".f90",
  ".pas",
  ".d",
  ".proto",
  ".graphql",
  ".gql",
  ".tf",

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

  if (textTypes && fileMatchesTypeList(name, type, textTypes)) return "text";

  if (extraTypes && fileMatchesTypeList(name, type, extraTypes)) return "backend";

  return null;
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

  // Optional extractor size cap. For builtin types the backend is only a quality
  // boost over the client-side converters, so an oversized file simply skips it;
  // for backend-only types it's the sole path → reject with a clear message.
  const extractLimit = config.extractor?.maxFileSize;
  const overExtractLimit = extractLimit != null && file.size > extractLimit;

  // Try API extraction first for non-text builtin types
  if (config.extractor && kind === "builtin" && !overExtractLimit) {
    try {
      const text = await config.client.extractText(file);
      if (text?.trim()) return text;
    } catch {
      // fall through to client-side converter
    }
  }

  // Backend-only types → extractText is the only path
  if (kind === "backend") {
    if (overExtractLimit) {
      throw new Error(
        `${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(extractLimit as number)} extract limit`,
      );
    }
    return config.client.extractText(file);
  }

  // Built-in converters
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || file.type === MIME_XLSX) {
    const results = await xlsxToCsv(file);
    if (results.length === 0) return "";
    if (results.length === 1) return csvToMarkdownTable(results[0].csv);
    return results.map((r) => `# ${r.sheetName}\n\n${csvToMarkdownTable(r.csv)}`).join("\n\n");
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
