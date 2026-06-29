import { getConfig } from "@/shared/config";
import { readFileAsText } from "@/shared/lib/convert";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "@/shared/lib/mediaTypes";
import { fileExtension, formatBytes, readAsDataURL } from "@/shared/lib/utils";

// Artifact kind type
export type ArtifactKind =
  | "text"
  | "code"
  | "svg"
  | "mermaid"
  | "html"
  | "csv"
  | "markdown"
  | "image"
  | "audio"
  | "video"
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
// their high-fidelity editors (PptxEditor/DocxEditor/XlsxEditor), PDFs via
// PdfEditor, and email files (.msg/.eml) are extracted on demand (preview
// via OfficeMarkdownEditor or AI via Python `extract-msg` / `email`).
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
  const maxFileSize = getConfig().artifacts?.maxFileSize;
  if (maxFileSize != null && file.size > maxFileSize) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(maxFileSize)} limit`);
  }

  const ext = fileExtension(file.name);

  if (BINARY_PRESERVED_MIME_BY_EXT[ext]) {
    const contentType = file.type || BINARY_PRESERVED_MIME_BY_EXT[ext];
    const content = await readAsDataURL(file);
    return [{ path: `/${file.name}`, content, contentType }];
  }

  // Everything else is stored verbatim — text/code as text, other binaries as
  // data URLs. No conversion: the artifact holds the original file.
  const contentType = file.type || inferContentTypeFromPath(file.name) || "text/plain";
  const content = isTextContentType(contentType) ? await readFileAsText(file) : await readAsDataURL(file);

  return [{ path: `/${file.name}`, content, contentType }];
}

// `artifactLanguage` now lives in shared (so non-feature code can use it too);
// re-exported here for existing importers.
export { artifactLanguage } from "@/shared/lib/fileTypes";

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

  // Mermaid diagrams — rendered natively (offline) in the drawer
  if (ext === "mmd" || ext === "mermaid" || normalizedContentType === "text/vnd.mermaid") {
    return "mermaid";
  }

  // CSV files
  if (ext === "csv" || ext === "tsv") {
    return "csv";
  }

  // Markdown files
  if (ext === "md" || ext === "markdown") {
    return "markdown";
  }

  if (normalizedContentType?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }

  // PDF files
  if (ext === "pdf" || normalizedContentType === "application/pdf") {
    return "pdf";
  }

  // Office documents (high-fidelity editors; OfficeMarkdownEditor is the
  // extraction fallback) and email (extracted text)
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

  // Audio/video for the media player. Checked after code extensions because
  // browsers report odd MIME types for some code files (.ts → video/mp2t).
  if (normalizedContentType?.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) {
    return "audio";
  }

  if (normalizedContentType?.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }

  // Extensions caught earlier (pdf, docx, xlsx, pptx, audio/video) are omitted.
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
