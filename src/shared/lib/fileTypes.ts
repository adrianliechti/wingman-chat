import { lookupContentType } from "./utils";

// Overrides for two cases:
// 1. Text/code files where `mime` maps to a wrong binary type
// 2. Binary files where `mime` returns null (→ undefined → wrongly treated as text)
const MIME_OVERRIDES: Record<string, string> = {
  ".ts": "text/typescript", // mime: video/mp2t
  ".rs": "text/x-rustsrc", // mime: application/rls-services+xml
  ".cjs": "text/javascript", // mime: application/node
  ".sc": "text/x-scala", // mime: application/vnd.ibm.secure-container
  ".dart": "text/x-dart", // mime: application/vnd.dart
  ".php": "text/x-php", // mime: application/x-httpd-php
  ".pl": "text/x-perl", // mime: application/x-perl
  ".pm": "text/x-perl", // mime: application/x-perl
  ".scm": "text/x-scheme", // mime: application/vnd.lotus-screencam
  ".vhd": "text/x-vhdl", // mime: application/x-virtualbox-vhd
  ".json5": "application/json", // mime: application/json5 (not in isTextContentType)
  ".mmd": "text/vnd.mermaid", // mime: null → would be stored as binary; it's Mermaid diagram source
  ".mermaid": "text/vnd.mermaid",
  ".tgz": "application/gzip",
  ".pyc": "application/octet-stream",
  ".pkl": "application/octet-stream",
  ".pickle": "application/octet-stream",
  ".sqlite": "application/octet-stream",
  ".db": "application/octet-stream",
  // Scientific / data binaries from the Python stack (numpy, pandas, scipy,
  // sklearn) that `mime` doesn't know — without an override they default to text
  // and get corrupted by the UTF-8 round trip through the sandbox FS.
  ".npy": "application/octet-stream",
  ".npz": "application/octet-stream",
  ".parquet": "application/octet-stream",
  ".feather": "application/octet-stream",
  ".arrow": "application/octet-stream",
  ".h5": "application/octet-stream",
  ".hdf5": "application/octet-stream",
  ".mat": "application/octet-stream",
  ".joblib": "application/octet-stream",
  ".bin": "application/octet-stream",
};

export function inferContentTypeFromPath(path: string): string | undefined {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) {
    return undefined;
  }

  const ext = path.slice(lastDot).toLowerCase();
  return MIME_OVERRIDES[ext] ?? lookupContentType(ext);
}

export function isTextContentType(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/javascript" ||
    contentType === "application/xml" ||
    contentType === "application/yaml" ||
    contentType === "application/x-yaml" ||
    contentType === "application/toml" ||
    contentType === "application/x-sh" ||
    contentType === "application/sql" ||
    contentType === "image/svg+xml"
  );
}

export function isBinaryContentType(contentType?: string): boolean {
  return !!contentType && !isTextContentType(contentType);
}

/** Match a file against a config type entry — an extension (".eml") or a MIME type ("message/rfc822"). */
export function fileMatchesType(name: string, type: string, entry: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e.startsWith(".")) return name.toLowerCase().endsWith(e);
  const t = type.toLowerCase();
  return t === e || inferContentTypeFromPath(name)?.toLowerCase() === e;
}

/** Whether a file matches any entry (extension or MIME) in a config type list. */
export function fileMatchesTypeList(name: string, type: string, list: string[]): boolean {
  return list.some((entry) => fileMatchesType(name, type, entry));
}

/**
 * Syntax-highlight language id for a file path. Returns the raw extension (shiki
 * accepts extension aliases like `py` / `ts`), with special-cases for the common
 * extensionless build files.
 */
export function artifactLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const basename = path.split("/").pop()?.toLowerCase() || "";
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) return "dockerfile";
  if (basename === "makefile" || basename.startsWith("makefile.")) return "makefile";
  return ext;
}
