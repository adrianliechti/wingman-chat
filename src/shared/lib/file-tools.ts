/**
 * Shared file tool factory.
 *
 * Produces list, read, create, delete, move, grep, and glob tools that
 * operate on a pluggable data source. Both the artifacts filesystem and
 * notebook sources use this instead of duplicating tool definitions.
 */

import { FilePen, FilePlus2, FileSearch, Files, FileText, FolderInput, Search, Trash2 } from "lucide-react";
import { artifactDelta, type ArtifactMutation } from "../types/artifact";
import type { TextContent, Tool, ToolContext } from "../types/chat";
import {
  type ArtifactValidationResult,
  type ArtifactValidator,
  formatArtifactValidationIssue,
  validateArtifact,
} from "./artifact-validation";
import { isDataUrl } from "./fileContent";
import { artifactLanguage } from "./fileTypes";
import { formatLineOutput, getLineRange, grepText, matchGlob, splitLines, truncateLine } from "./text-utils";

// ---------------------------------------------------------------------------
// Data-source adapter
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string;
  size?: number;
  contentType?: string;
  revision?: string;
}

export interface FileData {
  path: string;
  content: string;
  contentType?: string;
  revision?: string;
}

/** Read-only data source (e.g. notebook sources). */
export interface ReadableFileSource {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<FileData | undefined>;
}

/** Read-write data source (e.g. artifacts filesystem). */
export interface WritableFileSource extends ReadableFileSource {
  write(
    path: string,
    content: string,
    contentType?: string,
    options?: { baseRevision?: string | null },
  ): Promise<void | ArtifactMutation[]>;
  remove(path: string, options?: { baseRevision?: string | null }): Promise<boolean | ArtifactMutation[]>;
  move(from: string, to: string, options?: { baseRevision?: string | null }): Promise<boolean | ArtifactMutation[]>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FileToolsOptions {
  /** Maximum lines returned by read (default: 500). */
  maxReadLines?: number;
  /** Maximum characters returned by read (default: 50000). */
  maxReadChars?: number;
  /** Maximum grep matches per file (default: 20). */
  maxGrepMatches?: number;
  /** Maximum total grep matches across all files (default: 100). */
  maxTotalGrepMatches?: number;
  /** Maximum characters per grep line (default: 200). */
  maxGrepLineChars?: number;
  /** Default context lines for grep (default: 2). */
  defaultContextLines?: number;
  /** Tool name namespace prefix (e.g. "source_" for notebook). Empty string by default. */
  namespace?: string;
  /** Optional syntax/structure validators run before text writes and extension-changing moves. */
  validators?: readonly ArtifactValidator[];
}

const DEFAULTS: Required<FileToolsOptions> = {
  maxReadLines: 500,
  maxReadChars: 50_000,
  maxGrepMatches: 20,
  maxTotalGrepMatches: 100,
  maxGrepLineChars: 200,
  defaultContextLines: 2,
  namespace: "",
  validators: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(t: string): TextContent[] {
  return [{ type: "text" as const, text: t }];
}

function error(message: string): TextContent[] {
  return [{ type: "text" as const, text: JSON.stringify({ error: message }) }];
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function validateWrite(
  path: string,
  content: string,
  contentType: string | undefined,
  opts: Required<FileToolsOptions>,
): Promise<ArtifactValidationResult> {
  return validateArtifact({ path, content, contentType }, opts.validators);
}

/**
 * Recover a text body from a few common non-strict function-call shapes.
 * Strict-capable model APIs should always send `content` as a string, but some
 * OpenAI-compatible/realtime providers ignore strict schemas and emit an array
 * of lines or wrap the text in `{ html: ... }` / `{ text: ... }` instead.
 * Keep this deliberately narrow so arbitrary objects are never stringified into
 * a file by accident.
 */
function coerceFileContent(args: Record<string, unknown>): string | undefined {
  const aliases = ["content", "contents", "html", "text", "body", "source", "code", "file_content"] as const;
  const raw =
    args.content ??
    aliases
      .slice(1)
      .map((key) => args[key])
      .find((value) => value !== undefined);

  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((line): line is string => typeof line === "string")) {
    return raw.join("\n");
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const wrapped = raw as Record<string, unknown>;
    for (const key of aliases) {
      if (typeof wrapped[key] === "string") return wrapped[key];
    }
  }
  return undefined;
}

/**
 * Same fallback idea for the target path: providers that garble the strict
 * schema sometimes deliver it under a `file_path`/`filename` style key.
 */
function coerceFilePath(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path", "filepath", "file_name", "filename", "file"] as const) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** Describe what actually arrived, so the model can self-correct the retry. */
function describeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  return keys.length ? `Received argument keys: ${keys.join(", ")}.` : "Received no arguments.";
}

function validationDetails(result: ArtifactValidationResult):
  | {
      errors?: string[];
      warnings?: string[];
    }
  | undefined {
  if (!result.errors.length && !result.warnings.length) return undefined;
  return {
    errors: result.errors.length ? result.errors.map(formatArtifactValidationIssue) : undefined,
    warnings: result.warnings.length ? result.warnings.map(formatArtifactValidationIssue) : undefined,
  };
}

function publishArtifactDelta(context: ToolContext | undefined, mutations: ArtifactMutation[]): void {
  if (mutations.length === 0) return;
  context?.setMeta?.({ artifactDelta: artifactDelta(mutations) });
}

function resolvedMutations(
  result: void | boolean | ArtifactMutation[],
  fallback: ArtifactMutation,
): ArtifactMutation[] {
  if (Array.isArray(result)) return result;
  return result === false ? [] : [fallback];
}

function revisionArgument(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

// Anthropic-compatible gateways compile every strict schema together and can
// reject a broad artifact toolbox before the model runs. Reserve strict mode
// for the compact create/delete/move mutations; the read/search helpers and
// nested edit schema remain schema-guided and are validated defensively here.
const SCHEMA_GUIDED = false;
const STRICT_MUTATION = true;

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

function createListTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}list_files`,
    strict: SCHEMA_GUIDED,
    display: {
      header: (_args, state) => ({ icon: Files, label: state.error ? "List failed" : "Listed files" }),
    },
    description: "List all available files with their sizes.",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: 'Directory path to filter files, or "/" to list all files.',
        },
      },
      required: ["directory"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const rawDir = (args.directory as string | null | undefined) ?? "/";
      const dir = rawDir === "/" ? rawDir : rawDir.replace(/\/+$/, "");

      const entries = await source.list();
      const filtered =
        !dir || dir === "/" ? entries : entries.filter((e) => e.path === dir || e.path.startsWith(`${dir}/`));
      filtered.sort((a, b) => a.path.localeCompare(b.path));

      const lines = filtered.map((e) => {
        const size = e.size != null ? ` (${e.size}C)` : "";
        return `${e.path}${size}`;
      });

      return text([`# ${filtered.length} files`, ...lines].join("\n"));
    },
  };
}

function createReadTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}read_file`,
    strict: SCHEMA_GUIDED,
    display: {
      header: (_args, state) => ({
        icon: FileText,
        label: state.error ? "Read failed" : state.running ? "Reading file…" : "Read file",
      }),
    },
    description: `Read file content with line numbers. Output is capped at ${opts.maxReadLines} lines or ${opts.maxReadChars} chars. Use startLine/endLine to page through large files.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path to read.",
        },
        startLine: {
          type: "integer",
          description: "Start line number (1-indexed). Use 1 to start at the beginning.",
        },
        endLine: {
          type: "integer",
          description: "End line number (1-indexed, inclusive), or 0 for the default page size.",
        },
      },
      required: ["path", "startLine", "endLine"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const path = args.path as string;
      if (!path) return error("path is required");

      const file = await source.read(path);
      if (!file) return error(`File not found: ${path}`);

      const content = file.content;
      if (!content) return text(`# ${path} (0 lines)\n[empty file]`);

      if (isDataUrl(content)) {
        const ct = file.contentType ?? "application/octet-stream";
        const guidance = ct.startsWith("image/")
          ? "If this image is already visible in the conversation, inspect it directly with built-in vision. Otherwise use a vision/OCR helper only when needed."
          : "Use the appropriate interpreter library only when programmatic processing is needed; the file is available in the sandbox.";
        return text(`# ${path} (binary, ${ct})\n[Binary file — not shown as text. ${guidance}]`);
      }

      const allLines = splitLines(content);
      const totalLines = allLines.length;

      const rawStartLine = args.startLine as number | null | undefined;
      const startLine = Math.max(1, Math.floor(rawStartLine ?? 1));

      if (startLine > totalLines) {
        return error(`startLine ${startLine} is beyond end of file (${totalLines} lines)`);
      }

      const maxEndLine = Math.min(startLine + opts.maxReadLines - 1, totalLines);
      const rawEndLine = typeof args.endLine === "number" ? args.endLine : 0;
      const requestedEndLine = rawEndLine <= 0 ? maxEndLine : Math.floor(rawEndLine);
      const endLine = Math.min(Math.max(startLine, requestedEndLine), maxEndLine);

      const requestedLines = getLineRange(allLines, startLine, endLine);
      const returnedLines: string[] = [];
      let outputChars = 0;
      let charTruncated = false;
      let longLineTruncated = false;
      for (const line of requestedLines) {
        const separatorChars = returnedLines.length > 0 ? 1 : 0;
        if (outputChars + separatorChars + line.length <= opts.maxReadChars) {
          returnedLines.push(line);
          outputChars += separatorChars + line.length;
          continue;
        }

        charTruncated = true;
        if (returnedLines.length === 0) {
          returnedLines.push(line.slice(0, opts.maxReadChars));
          longLineTruncated = true;
        }
        break;
      }

      const actualEndLine = startLine + returnedLines.length - 1;
      const hasMore = actualEndLine < totalLines;
      const nextStart = actualEndLine + 1;
      const notices: string[] = [];
      if (charTruncated) notices.push(`truncated at ${opts.maxReadChars} chars`);
      if (longLineTruncated) notices.push(`line ${startLine} itself exceeds the character cap`);
      if (hasMore) notices.push(`Use startLine=${nextStart} to continue`);
      const notice = notices.length > 0 ? ` [${notices.join(". ")}]` : "";
      const revision = file.revision ? `, revision ${file.revision}` : "";
      const header = `# ${path} (lines ${startLine}-${actualEndLine} of ${totalLines}${revision})${notice}`;

      return text(`${header}\n${formatLineOutput(returnedLines, startLine)}`);
    },
  };
}

function createWriteTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}create_file`,
    strict: STRICT_MUTATION,
    display: {
      header: (_args, state) => ({
        icon: FilePlus2,
        label: state.error ? "Create failed" : state.running ? "Creating file…" : "Created file",
      }),
      // Show just the file content (the path is the header preview), highlighted by extension.
      input: (args) => {
        const content = args ? coerceFileContent(args) : undefined;
        if (!content) return [];
        const path = args ? coerceFilePath(args) : undefined;
        return [{ code: content, language: path ? artifactLanguage(path) : "text" }];
      },
    },
    description:
      "Create a new file or update an existing file with the specified path and content. Recognized structured formats are saved first, then validated; validation errors are reported so you can continue editing and retry.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path (e.g., /data/output.csv). Should start with /.",
        },
        content: {
          type: "string",
          description: "The content of the file to create.",
        },
        baseRevision: {
          type: "string",
          description: 'Revision returned by read_file when overwriting an existing file, or "" for a new file.',
        },
      },
      required: ["path", "content", "baseRevision"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const path = coerceFilePath(args);
      if (!path) {
        return error(
          `path is required and must be a string like "/script.py". ${describeArgs(args)} Re-send the call as {"path": "...", "content": "..."}.`,
        );
      }
      // Empty strings remain valid. The coercion is a fallback for providers
      // which ignore the strict schema; it never stringifies arbitrary values.
      const content = coerceFileContent(args);
      if (content === undefined) {
        return error(
          `content is required and must be a string holding the full file text. ${describeArgs(args)} Re-send the call as {"path": "${path}", "content": "..."}.`,
        );
      }

      try {
        const existing = await source.read(path);
        const writeResult = await source.write(path, content, undefined, {
          baseRevision: revisionArgument(args.baseRevision, existing?.revision),
        });
        const mutations = resolvedMutations(writeResult, {
          operation: existing ? "update" : "create",
          path,
          size: new TextEncoder().encode(content).byteLength,
        });
        publishArtifactDelta(context, mutations);
      } catch (writeError) {
        return error(errorMessage(writeError));
      }
      const validation = await validateWrite(path, content, undefined, opts);
      return text(
        JSON.stringify({
          success: true,
          message: validation.errors.length
            ? `File created: ${path}. It was saved with validation errors; fix them in a follow-up edit.`
            : `File created: ${path}`,
          path,
          validation: validationDetails(validation),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// edit_file helpers
// ---------------------------------------------------------------------------

/** A single find/replace operation parsed from the tool arguments. */
interface EditOp {
  find: string;
  replace: string;
  replaceAll: boolean;
}

// Unicode -> ASCII folds applied during fuzzy matching. Built from code points
// so the source stays ASCII (no invisible characters in regex character classes).
const FUZZY_FOLDS: Array<{ chars: number[]; to: string }> = [
  { chars: [0x2018, 0x2019, 0x201a, 0x201b], to: "'" }, // smart single quotes
  { chars: [0x201c, 0x201d, 0x201e, 0x201f], to: '"' }, // smart double quotes
  { chars: [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212], to: "-" }, // hyphens/dashes/minus
  {
    chars: [0x00a0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000],
    to: " ",
  }, // NBSP and assorted unicode spaces
];
const FUZZY_FOLD_REGEXES: Array<{ re: RegExp; to: string }> = FUZZY_FOLDS.map(({ chars, to }) => ({
  re: new RegExp(`[${chars.map((c) => String.fromCharCode(c)).join("")}]`, "g"),
  to,
}));

interface NormalizedTextMap {
  text: string;
  /** Original UTF-16 start/end offsets for each UTF-16 code unit in `text`. */
  starts: number[];
  ends: number[];
}

/**
 * Normalize text for matching while retaining the original span represented by
 * every normalized code unit. This lets fuzzy matching replace only the matched
 * source text instead of writing the normalized copy of the entire file.
 */
function normalizeForFuzzyMatch(source: string): NormalizedTextMap {
  const rawChars: string[] = [];
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];

  for (let offset = 0; offset < source.length;) {
    const codePoint = source.codePointAt(offset);
    if (codePoint === undefined) break;
    const original = String.fromCodePoint(codePoint);
    const end = offset + original.length;
    let normalized = original.normalize("NFKC");
    for (const { re, to } of FUZZY_FOLD_REGEXES) normalized = normalized.replace(re, to);

    // A compatibility character can expand to several code units. Each one
    // still represents the same original source span.
    for (let i = 0; i < normalized.length; i++) {
      rawChars.push(normalized[i]);
      rawStarts.push(offset);
      rawEnds.push(end);
    }
    offset = end;
  }

  const rawText = rawChars.join("");
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  // Drop trailing whitespace per line while retaining mappings for the
  // characters that survive. Newlines stay anchored after removed whitespace.
  for (let lineStart = 0; lineStart <= rawText.length;) {
    const newline = rawText.indexOf("\n", lineStart);
    const lineEnd = newline >= 0 ? newline : rawText.length;
    const trimmedEnd = lineStart + rawText.slice(lineStart, lineEnd).trimEnd().length;

    for (let i = lineStart; i < trimmedEnd; i++) {
      chars.push(rawChars[i]);
      starts.push(rawStarts[i]);
      ends.push(rawEnds[i]);
    }
    if (newline < 0) break;

    chars.push(rawChars[newline]);
    starts.push(rawStarts[newline]);
    ends.push(rawEnds[newline]);
    lineStart = newline + 1;
  }

  return { text: chars.join(""), starts, ends };
}

function findAll(text: string, search: string): number[] {
  const indices: number[] = [];
  for (let from = text.indexOf(search); from >= 0; from = text.indexOf(search, from + search.length)) {
    indices.push(from);
  }
  return indices;
}

/**
 * Coerce the raw tool arguments into a list of edits. Accepts the canonical
 * `edits: [{ find, replace, replace_all }]` array, the same array sent as a JSON
 * string (some models do this), `oldText`/`newText` aliases, and a legacy
 * top-level single `find`/`replace`. Returns an error string instead of throwing.
 */
function coerceEdits(args: Record<string, unknown>): { edits: EditOp[] } | { error: string } {
  let raw: unknown = args.edits;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      // Leave as the raw string; handled as "not an array" below.
    }
  }

  // Legacy / single-edit shape: top-level find+replace with no edits array.
  if (!Array.isArray(raw)) {
    if (typeof args.find === "string" || typeof args.oldText === "string") {
      const find = (args.find ?? args.oldText) as string;
      const replace = args.replace ?? args.newText;
      if (typeof replace !== "string") {
        return { error: 'replace is required and must be a string (use "" to delete the matched text).' };
      }
      return { edits: [{ find, replace, replaceAll: args.replace_all === true }] };
    }
    return { error: "edits is required: an array of { find, replace } objects." };
  }

  if (raw.length === 0) return { error: "edits must contain at least one { find, replace } object." };

  const edits: EditOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return { error: `edits[${i}] must be a { find, replace } object.` };
    const o = item as Record<string, unknown>;
    const find = typeof o.find === "string" ? o.find : typeof o.oldText === "string" ? o.oldText : undefined;
    const replace = typeof o.replace === "string" ? o.replace : typeof o.newText === "string" ? o.newText : undefined;
    if (typeof find !== "string" || find.length === 0) return { error: `edits[${i}].find is required and non-empty.` };
    // Require `replace` explicitly: defaulting a missing value to "" would turn a
    // truncated or incomplete call into a silent deletion of the matched text.
    if (typeof replace !== "string") {
      return { error: `edits[${i}].replace is required and must be a string (use "" to delete the matched text).` };
    }
    edits.push({ find, replace, replaceAll: o.replace_all === true });
  }
  return { edits };
}

/**
 * Apply all edits against the ORIGINAL content (not sequentially): every `find`
 * is located in the same base text, the resulting spans are checked for overlap,
 * then applied right-to-left so earlier offsets stay valid. Matching is exact
 * first; an edit that misses retries in fuzzy-normalized space and maps its
 * matches back to spans in the untouched original text.
 */
function applyEdits(
  original: string,
  edits: EditOp[],
): { next: string; usedFuzzy: boolean; spans: number } | { error: string } {
  let mappedBase: NormalizedTextMap | undefined;
  let usedFuzzy = false;

  interface Span {
    start: number;
    end: number;
    replace: string;
    editIndex: number;
  }
  const spans: Span[] = [];
  for (let i = 0; i < edits.length; i++) {
    let find = edits[i].find;
    let indices = findAll(original, find);
    let fuzzyMatch = false;

    if (indices.length === 0) {
      mappedBase ??= normalizeForFuzzyMatch(original);
      find = normalizeForFuzzyMatch(find).text;
      if (find.length === 0) return { error: `edits[${i}].find is empty after normalization.` };
      indices = findAll(mappedBase.text, find);
      fuzzyMatch = true;
      usedFuzzy = true;
    }

    const replace = edits[i].replace;
    if (indices.length === 0) {
      return {
        error: `edits[${i}]: \`find\` text not found. An earlier read may be stale — read_file and retry with the exact current text.`,
      };
    }
    if (!edits[i].replaceAll && indices.length > 1) {
      return {
        error: `edits[${i}]: \`find\` matches ${indices.length} places. Provide a longer, unique snippet or set replace_all: true.`,
      };
    }
    for (const start of indices) {
      const end = start + find.length;
      spans.push({
        start: fuzzyMatch && mappedBase ? mappedBase.starts[start] : start,
        end: fuzzyMatch && mappedBase ? mappedBase.ends[end - 1] : end,
        replace,
        editIndex: i,
      });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) {
      return {
        error: `edits[${spans[i - 1].editIndex}] and edits[${spans[i].editIndex}] target overlapping text. Merge them into one edit or target disjoint regions.`,
      };
    }
  }

  let next = original;
  for (let i = spans.length - 1; i >= 0; i--) {
    next = next.slice(0, spans[i].start) + spans[i].replace + next.slice(spans[i].end);
  }
  if (next === original) {
    return { error: "No changes — the replacement(s) produced identical content." };
  }
  return { next, usedFuzzy, spans: spans.length };
}

function createEditTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}edit_file`,
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => ({
        icon: FilePen,
        label: state.error ? "Edit failed" : state.running ? "Editing file…" : "Edited file",
        preview: typeof args?.path === "string" ? args.path.replace(/^\/+/, "") : undefined,
      }),
    },
    description:
      "Make targeted edits to an existing text file by replacing exact snippets. Prefer this over create_file when refining a file or building one up in steps — only the changed snippets are sent, avoiding a large re-escaped body. Pass one or more edits in `edits`; each `find` is matched against the ORIGINAL file (not applied in sequence), so the snippets must not overlap. `find` must match the current text (including whitespace) and be unique unless replace_all is true; minor whitespace/quote/dash differences are tolerated automatically. Recognized structured formats are saved first, then validation findings are reported.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file to edit (e.g., /analysis.py)." },
        edits: {
          type: "array",
          description:
            "One or more replacements applied in a single pass. Use several entries here instead of multiple edit_file calls when changing several places in one file.",
          items: {
            type: "object",
            properties: {
              find: { type: "string", description: "Exact text to replace." },
              replace: {
                type: "string",
                description: "Replacement text (empty string deletes the matched text).",
              },
              replace_all: {
                type: "boolean",
                description:
                  "Replace every occurrence of find instead of requiring a unique match. Pass false for the default behavior.",
              },
            },
            required: ["find", "replace", "replace_all"],
            additionalProperties: false,
          },
        },
        baseRevision: {
          type: "string",
          description: 'Revision returned by the read_file call this edit is based on, or "" when unavailable.',
        },
      },
      required: ["path", "edits", "baseRevision"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const path = args.path as string;
      if (!path) return error("path is required");

      const coerced = coerceEdits(args);
      if ("error" in coerced) return error(coerced.error);

      const file = await source.read(path);
      if (!file) return error(`File not found: ${path}. Use list_files to see what exists.`);
      if (isDataUrl(file.content)) return error(`${path} is a binary file and cannot be text-edited.`);

      const result = applyEdits(file.content, coerced.edits);
      if ("error" in result) return error(`${result.error.replace(/\.$/, "")} (in ${path}).`);

      try {
        const writeResult = await source.write(path, result.next, file.contentType, {
          baseRevision: revisionArgument(args.baseRevision, file.revision),
        });
        const mutations = resolvedMutations(writeResult, {
          operation: "update",
          path,
          contentType: file.contentType,
          size: new TextEncoder().encode(result.next).byteLength,
        });
        publishArtifactDelta(context, mutations);
      } catch (writeError) {
        return error(errorMessage(writeError));
      }
      const validation = await validateWrite(path, result.next, file.contentType, opts);

      const note = result.usedFuzzy ? "; matched with whitespace/punctuation normalization" : "";
      const count = `${result.spans} edit${result.spans === 1 ? "" : "s"}`;
      return text(
        JSON.stringify({
          success: true,
          message: `Applied ${count} to ${path} (${result.next.length} chars${note})${
            validation.errors.length ? "; saved with validation errors that need a follow-up edit" : ""
          }`,
          path,
          validation: validationDetails(validation),
        }),
      );
    },
  };
}

function createDeleteTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}delete_file`,
    strict: STRICT_MUTATION,
    display: {
      header: (_args, state) => ({ icon: Trash2, label: state.error ? "Delete failed" : "Deleted file" }),
    },
    description: "Delete a file or folder. When deleting a folder, all files within it will be deleted.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file or folder path to delete.",
        },
        baseRevision: {
          type: "string",
          description: 'Revision returned by read_file for a file target, or "" when deleting a folder.',
        },
      },
      required: ["path", "baseRevision"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const path = args.path as string;
      if (!path) return error("path is required");

      const file = await source.read(path);
      const removeResult = await source.remove(path, {
        baseRevision: revisionArgument(args.baseRevision, file?.revision),
      });
      const mutations = resolvedMutations(removeResult, { operation: "delete", path });
      if (mutations.length === 0) return error(`File or folder not found: ${path}`);
      publishArtifactDelta(context, mutations);
      return text(JSON.stringify({ success: true, message: `Deleted: ${path}`, path }));
    },
  };
}

function createMoveTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}move_file`,
    strict: STRICT_MUTATION,
    display: {
      header: (args, state) => {
        const from = (typeof args?.from === "string" ? args.from : "").replace(/^\/+/, "");
        const to = (typeof args?.to === "string" ? args.to : "").replace(/^\/+/, "");
        return {
          icon: FolderInput,
          label: state.error ? "Move failed" : "Moved file",
          preview: from && to ? `${from} → ${to}` : undefined,
        };
      },
    },
    description: "Move or rename a file from one path to another.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "The source file path.",
        },
        to: {
          type: "string",
          description: "The destination file path.",
        },
        baseRevision: {
          type: "string",
          description: 'Revision returned by read_file for the source file, or "" when moving a folder.',
        },
      },
      required: ["from", "to", "baseRevision"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const from = args.from as string;
      const to = args.to as string;
      if (!from || !to) return error("Both from and to are required");

      const file = await source.read(from);

      const moveResult = await source.move(from, to, {
        baseRevision: revisionArgument(args.baseRevision, file?.revision),
      });
      const mutations = resolvedMutations(moveResult, {
        operation: "move",
        from,
        path: to,
        contentType: file?.contentType,
      });
      if (mutations.length === 0) {
        return error(`Failed to move from ${from} to ${to}. Source may not exist or destination already exists.`);
      }
      publishArtifactDelta(context, mutations);
      const validation =
        file && !isDataUrl(file.content) ? await validateWrite(to, file.content, file.contentType, opts) : undefined;
      return text(
        JSON.stringify({
          success: true,
          message: validation?.errors.length
            ? `File moved from ${from} to ${to}. It was saved with validation errors; fix them in a follow-up edit.`
            : `File moved from ${from} to ${to}`,
          from,
          to,
          validation: validation ? validationDetails(validation) : undefined,
        }),
      );
    },
  };
}

function createGrepTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}grep`,
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => ({
        icon: Search,
        label: state.error ? "Search failed" : state.running ? "Searching files…" : "Searched files",
        preview: typeof args?.pattern === "string" ? args.pattern : undefined,
      }),
    },
    description:
      'Search for a regex pattern across files. Returns matching lines with context. Examples: "function\\s+\\w+", "TODO|FIXME"',
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for.",
        },
        filePattern: {
          type: "string",
          description: 'Glob to filter files (e.g., "*.csv"), or "" for all files.',
        },
        ignoreCase: {
          type: "boolean",
          description: "Whether matching is case-insensitive. Use true by default.",
        },
        contextLines: {
          type: "integer",
          description: `Context lines (0 or more) before/after each match. Use ${opts.defaultContextLines} by default.`,
        },
      },
      required: ["pattern", "filePattern", "ignoreCase", "contextLines"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      if (!pattern) return error("pattern is required");

      const filePattern = args.filePattern as string | undefined;
      const ignoreCase = (args.ignoreCase as boolean) ?? true;
      const contextLines = Math.max(0, Math.floor((args.contextLines as number | null) ?? opts.defaultContextLines));

      const entries = await source.list();
      let searchEntries = entries;
      if (filePattern) {
        searchEntries = entries.filter((e) => matchGlob(e.path, filePattern));
      }

      const outputLines: string[] = [];
      let totalMatches = 0;
      let currentFile = "";
      let anyLineTruncated = false;

      for (const entry of searchEntries) {
        if (totalMatches >= opts.maxTotalGrepMatches) break;

        const file = await source.read(entry.path);
        if (!file?.content) continue;
        if (isDataUrl(file.content)) continue;

        const { matches } = grepText(file.content, pattern, {
          ignoreCase,
          maxMatches: opts.maxGrepMatches,
          contextLines,
        });

        if (matches.length > 0) {
          for (const m of matches) {
            if (totalMatches >= opts.maxTotalGrepMatches) break;
            const prefix = m.isContext ? "-" : ":";
            const line = truncateLine(m.content, opts.maxGrepLineChars);
            if (line !== m.content) anyLineTruncated = true;
            if (entry.path !== currentFile) {
              currentFile = entry.path;
              outputLines.push(`${entry.path}:${m.lineNumber}${prefix}${line}`);
            } else {
              outputLines.push(`${m.lineNumber}${prefix}${line}`);
            }
            if (!m.isContext) totalMatches += 1;
          }
        }
      }

      const matchLimitReached = totalMatches >= opts.maxTotalGrepMatches;
      const notices: string[] = [];
      if (matchLimitReached) notices.push(`${opts.maxTotalGrepMatches} matches limit reached. Refine pattern for more`);
      if (anyLineTruncated)
        notices.push(`Some lines truncated to ${opts.maxGrepLineChars} chars. Use read_file to see full lines`);
      const suffix = notices.length > 0 ? `\n\n[${notices.join(". ")}]` : "";
      const header = `# ${totalMatches} matches in ${searchEntries.length} files`;
      return text([header, ...outputLines].join("\n") + suffix);
    },
  };
}

function createGlobTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}glob`,
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => ({
        icon: FileSearch,
        label: state.error ? "Glob failed" : "Found files",
        preview: typeof args?.pattern === "string" ? args.pattern : undefined,
      }),
    },
    description: 'Find files matching a glob pattern. Examples: "**/*.csv", "src/**/*.{ts,tsx}"',
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (supports *, **, ?, {a,b}).",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      if (!pattern) return error("pattern is required");

      const entries = await source.list();
      const matched = entries.filter((e) => matchGlob(e.path, pattern));
      matched.sort((a, b) => a.path.localeCompare(b.path));

      const lines = matched.map((e) => {
        const size = e.size != null ? ` (${e.size}C)` : "";
        return `${e.path}${size}`;
      });

      return text([`# ${matched.length} files matching "${pattern}"`, ...lines].join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create file tools for a read-only data source.
 * Returns: list_files, read_file, grep, glob
 */
export function createReadOnlyFileTools(source: ReadableFileSource, options?: FileToolsOptions): Tool[] {
  const opts = { ...DEFAULTS, ...options };
  return [
    createListTool(source, opts),
    createReadTool(source, opts),
    createGrepTool(source, opts),
    createGlobTool(source, opts),
  ];
}

/**
 * Create file tools for a read-write data source.
 * Returns: list_files, read_file, create_file, edit_file, delete_file, move_file, grep, glob
 */
export function createFileTools(source: WritableFileSource, options?: FileToolsOptions): Tool[] {
  const opts = { ...DEFAULTS, ...options };
  return [
    createListTool(source, opts),
    createReadTool(source, opts),
    createWriteTool(source, opts),
    createEditTool(source, opts),
    createDeleteTool(source, opts),
    createMoveTool(source, opts),
    createGrepTool(source, opts),
    createGlobTool(source, opts),
  ];
}
