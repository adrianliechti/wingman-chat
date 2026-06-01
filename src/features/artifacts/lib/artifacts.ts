import { convertFileToText, readFileAsText } from "@/shared/lib/convert";
import { isTextContentType } from "@/shared/lib/fileTypes";
import { readAsDataURL } from "@/shared/lib/utils";

// Artifact kind type
export type ArtifactKind =
  | "text"
  | "code"
  | "svg"
  | "html"
  | "csv"
  | "markdown"
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "email"
  | "binary";

// Result type for processed files
export interface ProcessedFile {
  path: string;
  content: string;
  contentType: string;
}

// Binary uploads preserved verbatim as data URLs. Office docs render via
// OfficeMarkdownEditor, PDFs via PdfEditor, and email files (.msg/.eml) are
// extracted on demand (preview or AI via Python `extract-msg` / `email`).
// Converting at upload time would lose the original formatting / attachments.
const BINARY_PRESERVED_MIME_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  msg: "application/vnd.ms-outlook",
  eml: "message/rfc822",
};

// Process an uploaded file, preserving office docs / PDFs / email files as
// binary so previewers and Python tools can use the originals.
export async function processUploadedFile(file: File): Promise<ProcessedFile[]> {
  const fileName = file.name.toLowerCase();
  const ext = fileName.split(".").pop() || "";

  if (BINARY_PRESERVED_MIME_BY_EXT[ext]) {
    const contentType = file.type || BINARY_PRESERVED_MIME_BY_EXT[ext];
    const content = await readAsDataURL(file);
    return [{ path: `/${file.name}`, content, contentType }];
  }

  // Try shared converter for text/code formats
  try {
    const content = await convertFileToText(file);
    return [{ path: `/${file.name}`, content, contentType: file.type || "text/plain" }];
  } catch (error) {
    console.error(`Error converting file ${file.name}:`, error);
  }

  // Final fallback: binary as data URL
  const contentType = file.type || "text/plain";
  const content = isTextContentType(contentType) ? await readFileAsText(file) : await readAsDataURL(file);

  return [
    {
      path: `/${file.name}`,
      content,
      contentType,
    },
  ];
}

// Helper function to get the language/extension from a file path
export function artifactLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const basename = path.split("/").pop()?.toLowerCase() || "";

  // Handle Dockerfile files
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  // Handle Makefile files
  if (basename === "makefile" || basename.startsWith("makefile.")) {
    return "makefile";
  }

  return ext;
}

// Helper function to determine the kind of artifact based on file extension and content type.
export function artifactKind(path: string, contentType?: string): ArtifactKind {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const basename = path.split("/").pop()?.toLowerCase() || "";
  const normalizedContentType = contentType?.toLowerCase();

  if (normalizedContentType === "image/svg+xml") {
    return "svg";
  }

  if (normalizedContentType === "text/html") {
    return "html";
  }

  if (normalizedContentType === "text/csv" || normalizedContentType === "text/tab-separated-values") {
    return "csv";
  }

  if (normalizedContentType === "text/markdown") {
    return "markdown";
  }

  // Dockerfile files (check for exact names)
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "code";
  }

  // Makefile files (check for exact names)
  if (basename === "makefile" || basename.startsWith("makefile.")) {
    return "code";
  }

  // HTML files
  if (ext === "html" || ext === "htm") {
    return "html";
  }

  // SVG files
  if (ext === "svg") {
    return "svg";
  }

  // CSV files
  if (ext === "csv" || ext === "tsv") {
    return "csv";
  }

  // Markdown files
  if (ext === "md" || ext === "markdown") {
    return "markdown";
  }

  const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff"];

  if (normalizedContentType?.startsWith("image/") || imageExtensions.includes(ext)) {
    return "image";
  }

  // PDF files
  if (ext === "pdf" || normalizedContentType === "application/pdf") {
    return "pdf";
  }

  // Office documents and email — previewed via OfficeMarkdownEditor
  if (
    ext === "docx" ||
    normalizedContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (ext === "xlsx" || normalizedContentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }

  if (
    ext === "pptx" ||
    normalizedContentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }

  if (
    ext === "msg" ||
    ext === "eml" ||
    normalizedContentType === "application/vnd.ms-outlook" ||
    normalizedContentType === "message/rfc822"
  ) {
    return "email";
  }

  // Code files
  const codeExtensions = [
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "py",
    "go",
    "rs",
    "java",
    "jar",
    "c",
    "cc",
    "cpp",
    "cxx",
    "h",
    "hpp",
    "hxx",
    "hh",
    "cs",
    "php",
    "rb",
    "swift",
    "kt",
    "kts",
    "scala",
    "sc",
    "dart",
    "m",
    "mm",
    "sh",
    "bash",
    "zsh",
    "ksh",
    "pl",
    "pm",
    "t",
    "r",
    "jl",
    "lua",
    "hs",
    "ex",
    "exs",
    "erl",
    "hrl",
    "fs",
    "fsi",
    "fsx",
    "fsscript",
    "vb",
    "vbs",
    "asm",
    "s",
    "S",
    "sql",
    "d.ts",
    "groovy",
    "gradle",
    "coffee",
    "nim",
    "clj",
    "cljs",
    "edn",
    "lisp",
    "scm",
    "rkt",
    "ml",
    "mli",
    "ada",
    "adb",
    "ads",
    "pas",
    "pp",
    "f",
    "f90",
    "f95",
    "for",
    "v",
    "vh",
    "sv",
    "vhd",
    "vhdl",
    "css",
    "scss",
    "sass",
    "less",
    "styl",
    "json",
    "jsonc",
    "json5",
    "yaml",
    "yml",
    "toml",
    "ini",
    "conf",
    "cfg",
    "xml",
  ];

  if (codeExtensions.includes(ext || "")) {
    return "code";
  }

  // Extensions caught earlier (pdf, docx, xlsx, pptx) are omitted.
  const binaryExtensions = [
    "zip",
    "gz",
    "tgz",
    "bz2",
    "xz",
    "7z",
    "rar",
    "doc",
    "ppt",
    "xls",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "aac",
    "flac",
    "mp4",
    "webm",
    "mov",
    "avi",
    "mkv",
    "wmv",
    "bin",
    "wasm",
    "pyc",
    "pkl",
    "pickle",
    "sqlite",
    "db",
    "ico",
  ];

  if ((normalizedContentType && !isTextContentType(normalizedContentType)) || binaryExtensions.includes(ext)) {
    return "binary";
  }

  // Default to text for everything else
  return "text";
}
