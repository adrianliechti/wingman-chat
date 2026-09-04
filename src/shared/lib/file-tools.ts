/**
 * Shared file tool factory.
 *
 * Produces a canonical set of namespaced file tools over a pluggable source.
 * Read-only sources get read/grep/glob; writable sources additionally get
 * create/edit/delete/move. The same schemas are used for every file space.
 */

import { FilePen, FilePlus2, FileSearch, FileText, FolderInput, Search, Trash2 } from "lucide-react";
import { artifactDelta, type ArtifactMutation } from "../types/artifact";
import type { TextContent, Tool, ToolContext } from "../types/chat";
import type { File, FileEntry } from "../types/file";
import {
  type ArtifactValidationResult,
  type ArtifactValidator,
  formatArtifactValidationIssue,
  validateArtifact,
} from "./artifact-validation";
import { isDataUrl } from "./fileContent";
import { artifactLanguage } from "./fileTypes";
import { normalizeArtifactPath } from "./sandbox";
import { formatLineOutput, getLineRange, matchGlob, splitLines, textFormat, truncateLine } from "./text-utils";

// ---------------------------------------------------------------------------
// File-source adapter
// ---------------------------------------------------------------------------

export interface ReadonlyFileSource {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<File | undefined>;
}

export interface WritableFileSource extends ReadonlyFileSource {
  write(path: string, content: string, contentType?: string): Promise<void | ArtifactMutation[]>;
  /** Commit a staged set of text-file upserts as one all-or-nothing operation. */
  writeBatch(files: readonly File[]): Promise<void | ArtifactMutation[]>;
  remove(path: string): Promise<boolean | ArtifactMutation[]>;
  move(from: string, to: string): Promise<boolean | ArtifactMutation[]>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FileToolsOptions {
  /** Stable model-facing namespace, for example "artifacts" or "repository". */
  namespace: string;
  /** Human-readable singular name used in descriptions. Defaults to namespace. */
  spaceName?: string;
  /** Maximum lines returned by read (default: 2000). */
  maxReadLines?: number;
  /** Maximum characters returned by read (default: 48 KiB). */
  maxReadChars?: number;
  /** Maximum size of an existing text file accepted by edit (default: 10 MiB). */
  maxEditBytes?: number;
  /** Default number of grep result entries returned (default: 250). */
  defaultGrepLimit?: number;
  /** Maximum characters per grep line (default: 500). */
  maxGrepLineChars?: number;
  /** Maximum paths returned by glob (default: 100). */
  maxPathResults?: number;
  /** Optional syntax/structure validators run before text writes and extension-changing moves. */
  validators?: readonly ArtifactValidator[];
}

type ResolvedFileToolsOptions = Required<Omit<FileToolsOptions, "spaceName">> & { spaceName: string };

const DEFAULTS: Omit<ResolvedFileToolsOptions, "namespace" | "spaceName"> = {
  maxReadLines: 2_000,
  maxReadChars: 48 * 1024,
  maxEditBytes: 10 * 1024 * 1024,
  defaultGrepLimit: 250,
  maxGrepLineChars: 500,
  maxPathResults: 100,
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
  opts: ResolvedFileToolsOptions,
): Promise<ArtifactValidationResult> {
  return validateArtifact({ path, content, contentType }, opts.validators);
}

function toolName(opts: ResolvedFileToolsOptions, operation: string): string {
  return `${opts.namespace}_${operation}`;
}

function resolveOptions(options: FileToolsOptions): ResolvedFileToolsOptions {
  const namespace = options.namespace.trim();
  if (!namespace || !/^[a-z][a-z0-9_]*$/.test(namespace)) {
    throw new Error(`Invalid file-tool namespace: ${JSON.stringify(options.namespace)}`);
  }
  return {
    ...DEFAULTS,
    ...options,
    namespace,
    spaceName: options.spaceName?.trim() || namespace,
  };
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

// Keep the shared file toolbox schema-guided so optional defaults can simply be
// omitted. Every handler validates its required arguments defensively at runtime.
const SCHEMA_GUIDED = false;

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

function createReadTool(source: ReadonlyFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "read"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (_args, state) => ({
        icon: FileText,
        label: state.error ? "Read failed" : state.running ? "Reading file…" : "Read file",
      }),
    },
    description: `Read a file from the ${opts.spaceName} file space with 1-based line numbers. The header reports the text's UTF-8 BOM and line endings; the displayed text omits the BOM and normalizes newlines. Output is capped at ${opts.maxReadLines} lines or ${opts.maxReadChars} characters. Use offset and limit to page through large files.`,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The absolute virtual path to the file to read.",
        },
        offset: {
          type: "integer",
          minimum: 1,
          description: "1-based line number to start reading from. Defaults to 1.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Positive number of lines to read. Only provide for large files or known ranges.",
        },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const path = typeof args.file_path === "string" ? args.file_path : "";
      if (!path) return error("file_path is required");

      const file = await source.read(path);
      if (!file) return error(`File not found: ${path}`);
      const displayPath = file.path || path;

      const content = file.content.startsWith("\uFEFF") ? file.content.slice(1) : file.content;

      if (isDataUrl(content)) {
        const ct = file.contentType ?? "application/octet-stream";
        const guidance = ct.startsWith("image/")
          ? "If this image is already visible in the conversation, inspect it directly with built-in vision. Otherwise use a vision/OCR helper only when needed."
          : "Use the appropriate interpreter library only when programmatic processing is needed; the file is available in the sandbox.";
        return text(`# ${displayPath} (binary, ${ct})\n[Binary file — not shown as text. ${guidance}]`);
      }

      const format = textFormat(file.content);
      const formatNotice = `[UTF-8 BOM: ${format.utf8_bom ? "yes" : "no"}; line endings: ${format.line_endings}]`;
      if (!content) return text(`# ${displayPath} (0 lines) ${formatNotice}\n[empty file]`);

      const allLines = splitLines(content);
      const totalLines = allLines.length;

      const rawOffset = args.offset;
      if (rawOffset !== undefined && (typeof rawOffset !== "number" || !Number.isInteger(rawOffset) || rawOffset < 1)) {
        return error("offset must be a positive 1-based integer");
      }
      const startLine = (rawOffset as number | undefined) ?? 1;

      if (startLine > totalLines) {
        return error(`offset ${startLine} is beyond end of file (${totalLines} lines)`);
      }

      const rawLimit = args.limit;
      if (rawLimit !== undefined && (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1)) {
        return error("limit must be a positive integer");
      }
      const requestedLimit = Math.min((rawLimit as number | undefined) ?? opts.maxReadLines, opts.maxReadLines);
      const endLine = Math.min(startLine + requestedLimit - 1, totalLines);

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
      if (hasMore) notices.push(`use offset=${nextStart} to continue`);
      const notice = notices.length > 0 ? ` [${notices.join(". ")}]` : "";
      const header = `# ${displayPath} (lines ${startLine}-${actualEndLine} of ${totalLines}) ${formatNotice}${notice}`;

      return text(`${header}\n${formatLineOutput(returnedLines, startLine)}`);
    },
  };
}

function createWriteTool(source: WritableFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "create"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (_args, state) => ({
        icon: FilePlus2,
        label: state.error ? "Create failed" : state.running ? "Creating file…" : "Created file",
      }),
      // Show just the file content (the path is the header preview), highlighted by extension.
      input: (args) => {
        const content = typeof args?.content === "string" ? args.content : undefined;
        if (!content) return [];
        const path = typeof args?.file_path === "string" ? args.file_path : undefined;
        return [{ code: content, language: path ? artifactLanguage(path) : "text" }];
      },
    },
    description: [
      `Write the complete content of one file in the ${opts.spaceName} file space. Use this for a single new file or a deliberate full rewrite; create overwrites an existing file at the same path.`,
      `Read existing content with ${toolName(opts, "read")} before overwriting unless it is already established by earlier reads or successful writes. Prefer ${toolName(opts, "edit")} for targeted replacements or related multi-file changes and creations.`,
      "text_format reports the saved text's UTF-8 BOM and line endings.",
      "Recognized structured formats are saved, then validation findings are reported; a successful save can still need corrections.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: `The absolute virtual path in the ${opts.spaceName} file space (for example, /data/output.csv).`,
        },
        content: {
          type: "string",
          description: "The content of the file to create.",
        },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const path = typeof args.file_path === "string" ? args.file_path : "";
      if (!path) {
        return error('file_path is required and must be a string like "/script.py"');
      }
      // Empty strings remain valid; non-string values are never guessed or stringified.
      const content = typeof args.content === "string" ? args.content : undefined;
      if (content === undefined) return error("content is required and must be a string holding the full file text");

      let operation: "create" | "update" = "create";
      let resultPath = path;
      try {
        const existing = await source.read(path);
        operation = existing ? "update" : "create";
        const writeResult = await source.write(path, content);
        const mutations = resolvedMutations(writeResult, {
          operation,
          path,
          size: new TextEncoder().encode(content).byteLength,
        });
        resultPath = mutations[0]?.path ?? existing?.path ?? path;
        publishArtifactDelta(context, mutations);
      } catch (writeError) {
        return error(errorMessage(writeError));
      }
      const validation = await validateWrite(resultPath, content, undefined, opts);
      const verb = operation === "create" ? "created" : "updated";
      return text(
        JSON.stringify({
          success: true,
          message: validation.errors.length
            ? `File ${verb}: ${resultPath}. It was saved with validation errors; fix them in a follow-up edit.`
            : `File ${verb}: ${resultPath}`,
          operation,
          path: resultPath,
          text_format: isDataUrl(content) ? undefined : textFormat(content),
          validation: validationDetails(validation),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// edit helpers
// ---------------------------------------------------------------------------

/** A single file-scoped find/replace operation parsed from the tool arguments. */
interface FileEditOp {
  path: string;
  find: string;
  replace: string;
  replaceAll: boolean;
  /** Original position in the model-supplied batch, used in actionable errors. */
  index: number;
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

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z]/.test(char);
}

function isOpeningQuoteContext(chars: readonly string[], index: number): boolean {
  if (index === 0) return true;
  return [" ", "\t", "\n", "\r", "(", "[", "{"].includes(chars[index - 1]);
}

function applyCurlyDoubleQuotes(text: string): string {
  const chars = Array.from(text);
  return chars
    .map((char, index) => {
      if (char !== '"') return char;
      return isOpeningQuoteContext(chars, index) ? "“" : "”";
    })
    .join("");
}

function applyCurlySingleQuotes(text: string): string {
  const chars = Array.from(text);
  return chars
    .map((char, index) => {
      if (char !== "'") return char;
      if (isAsciiLetter(chars[index - 1]) && isAsciiLetter(chars[index + 1])) return "’";
      return isOpeningQuoteContext(chars, index) ? "‘" : "’";
    })
    .join("");
}

/** Preserve typographic quote style when only fuzzy quote folding made a match possible. */
function preserveReplacementQuoteStyle(requestedOld: string, actualOld: string, replacement: string): string {
  if (requestedOld === actualOld) return replacement;
  let styled = replacement;
  if (/[“”]/.test(actualOld)) styled = applyCurlyDoubleQuotes(styled);
  if (/[‘’]/.test(actualOld)) styled = applyCurlySingleQuotes(styled);
  return styled;
}

/**
 * Parse canonical Wingman-style batch arguments, including semantic checks
 * that JSON Schema cannot express (valid virtual paths, no-op replacements).
 */
function parseEdits(args: Record<string, unknown>): { edits: FileEditOp[] } | { error: string } {
  const rawEdits = args.edits;
  if (!Array.isArray(rawEdits)) {
    return {
      error: "edits is required: a non-empty array of { file_path, old_string, new_string } objects.",
    };
  }

  if (rawEdits.length === 0) {
    return { error: "edits must contain at least one { file_path, old_string, new_string } object." };
  }

  const edits: FileEditOp[] = [];
  for (let i = 0; i < rawEdits.length; i++) {
    const item = rawEdits[i];
    if (!item || typeof item !== "object") {
      return { error: `edits[${i}] must be a { file_path, old_string, new_string } object.` };
    }
    const o = item as Record<string, unknown>;
    const rawPath = typeof o.file_path === "string" ? o.file_path : undefined;
    const path = normalizeArtifactPath(rawPath);
    if (!path || path === "/") {
      return { error: `edits[${i}].file_path is required and must be a valid file path.` };
    }

    const find = o.old_string;
    const replace = o.new_string;
    if (typeof find !== "string") {
      return { error: `edits[${i}].old_string is required and must be a string.` };
    }
    // Require `new_string` explicitly: defaulting a missing value to "" would turn a
    // truncated or incomplete call into a silent deletion of the matched text.
    if (typeof replace !== "string") {
      return {
        error: `edits[${i}].new_string is required and must be a string (use "" to delete the matched text).`,
      };
    }
    if (find === replace && find !== "") {
      return { error: `edits[${i}].old_string and new_string are identical.` };
    }
    if (o.replace_all !== undefined && typeof o.replace_all !== "boolean") {
      return { error: `edits[${i}].replace_all must be a boolean when provided.` };
    }
    edits.push({
      path,
      find: find.replace(/\r\n?/g, "\n"),
      replace: replace.replace(/\r\n?/g, "\n"),
      replaceAll: o.replace_all === true,
      index: i,
    });
  }
  return { edits };
}

/**
 * Apply same-file edits in order, matching Wingman Agent and patch-tool
 * semantics: a later operation sees the result of every earlier operation.
 * Matching is exact first; a miss retries in fuzzy-normalized space and maps
 * matches back to spans in the current, otherwise untouched, text.
 */
function applyEdits(
  original: string,
  edits: readonly FileEditOp[],
): { next: string; usedFuzzy: boolean; spans: number } | { error: string } {
  let next = original;
  let usedFuzzy = false;
  let spanCount = 0;

  for (const edit of edits) {
    if (edit.find === "") {
      if (next.trim() !== "") {
        return {
          error: `edits[${edit.index}]: old_string may be empty only when creating a file or replacing an empty file.`,
        };
      }
      next = edit.replace;
      spanCount += 1;
      continue;
    }

    let find = edit.find;
    let indices = findAll(next, find);
    let fuzzyMatch = false;
    let mappedBase: NormalizedTextMap | undefined;

    if (indices.length === 0) {
      mappedBase = normalizeForFuzzyMatch(next);
      find = normalizeForFuzzyMatch(find).text;
      if (find.length === 0) return { error: `edits[${edit.index}].old_string is empty after normalization.` };
      indices = findAll(mappedBase.text, find);
      fuzzyMatch = true;
      usedFuzzy = true;
    }

    if (indices.length === 0) {
      return {
        error: `edits[${edit.index}]: old_string was not found. An earlier read may be stale — read and retry with the exact current text.`,
      };
    }
    if (!edit.replaceAll && indices.length > 1) {
      return {
        error: `edits[${edit.index}]: old_string matches ${indices.length} places. Provide a longer, unique snippet or set replace_all: true.`,
      };
    }

    const spans = indices.map((start) => {
      const end = start + find.length;
      return {
        start: fuzzyMatch && mappedBase ? mappedBase.starts[start] : start,
        end: fuzzyMatch && mappedBase ? mappedBase.ends[end - 1] : end,
      };
    });
    const before = next;
    for (let i = spans.length - 1; i >= 0; i--) {
      const actualOld = next.slice(spans[i].start, spans[i].end);
      const replacement = preserveReplacementQuoteStyle(edit.find, actualOld, edit.replace);
      next = next.slice(0, spans[i].start) + replacement + next.slice(spans[i].end);
    }
    if (next === before) return { error: `edits[${edit.index}] made no progress.` };
    spanCount += spans.length;
  }

  return { next, usedFuzzy, spans: spanCount };
}

function editLineEnding(content: string): "\n" | "\r\n" | "\r" {
  if (content.includes("\r\n")) return "\r\n";
  if (content.includes("\r")) return "\r";
  return "\n";
}

function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n" | "\r"): string {
  return lineEnding === "\n" ? content : content.replaceAll("\n", lineEnding);
}

interface StagedFileEdit {
  path: string;
  before: File | undefined;
  after: File;
  validation: ArtifactValidationResult;
  usedFuzzy: boolean;
  spans: number;
}

function batchValidationDetails(staged: readonly StagedFileEdit[]):
  | {
      errors?: string[];
      warnings?: string[];
    }
  | undefined {
  const errors = staged.flatMap(({ path, validation }) =>
    validation.errors.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`),
  );
  const warnings = staged.flatMap(({ path, validation }) =>
    validation.warnings.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`),
  );
  if (errors.length === 0 && warnings.length === 0) return undefined;
  return {
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

function editPreview(args: Record<string, unknown> | null): string | undefined {
  if (!args) return undefined;
  const edits = Array.isArray(args.edits) ? args.edits : [];
  const paths = [
    ...new Set(
      edits.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const path = (entry as Record<string, unknown>).file_path;
        return typeof path === "string" && path ? [path.replace(/^\/+/, "")] : [];
      }),
    ),
  ];
  if (paths.length === 1) return paths[0];
  if (paths.length > 1) return `${paths.length} files`;
  return typeof args.file_path === "string" ? args.file_path.replace(/^\/+/, "") : undefined;
}

function createEditTool(source: WritableFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "edit"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => {
        const preview = editPreview(args);
        const multiple = preview?.endsWith(" files") ?? false;
        return {
          icon: FilePen,
          label: state.error
            ? "Edit failed"
            : state.running
              ? multiple
                ? "Editing files…"
                : "Editing file…"
              : multiple
                ? "Edited files"
                : "Edited file",
          preview,
        };
      },
    },
    description: [
      `Create or edit one or more text files atomically in the ${opts.spaceName} file space using exact string replacements.`,
      `Put every independent replacement or multi-file creation you already know about into one edits array; use ${toolName(opts, "create")} for a single new file or a deliberate full rewrite.`,
      `Use current text established by earlier reads or successful writes; otherwise read the affected content with ${toolName(opts, "read")} first. Never include read output's line-number prefixes in old_string. Each old_string must occur exactly once unless replace_all is true; include enough unchanged surrounding text to make it unique.`,
      "To create a file (or replace an empty file), use an empty old_string and put its complete content in new_string.",
      "Entries for the same file run in order, so later entries see earlier replacements. All targets are staged before the atomic commit; if any entry fails, no file changes.",
      "Preserves an existing UTF-8 BOM and uniform line endings automatically; mixed line endings are normalized. text_formats reports the saved format for each path.",
      "Minor whitespace/quote/dash differences are tolerated automatically. Recognized structured formats are saved, then validation findings are reported; a successful save can still need corrections.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          minItems: 1,
          description: "All file creations and replacements to apply in one atomic transaction.",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: `Absolute virtual path in the ${opts.spaceName} file space, such as /report.md.`,
              },
              old_string: {
                type: "string",
                description: "Exact text to replace; empty only when creating a file or replacing an empty file.",
              },
              new_string: {
                type: "string",
                description:
                  "Replacement text, or complete content for a new file. An empty string deletes matched text.",
              },
              replace_all: {
                type: "boolean",
                description: "Replace every occurrence instead of requiring a unique match. Defaults to false.",
                default: false,
              },
            },
            required: ["file_path", "old_string", "new_string"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const parsed = parseEdits(args);
      if ("error" in parsed) return error(parsed.error);

      const editsByPath = new Map<string, FileEditOp[]>();
      for (const edit of parsed.edits) {
        const entries = editsByPath.get(edit.path) ?? [];
        entries.push(edit);
        editsByPath.set(edit.path, entries);
      }

      const staged: StagedFileEdit[] = [];
      for (const [path, edits] of editsByPath) {
        let file: File | undefined;
        try {
          file = await source.read(path);
        } catch (readError) {
          return error(errorMessage(readError));
        }
        if (!file && edits[0].find !== "") {
          return error(
            `File not found: ${path}. To create it, make edits[${edits[0].index}].old_string an empty string. No files changed.`,
          );
        }
        if (file && isDataUrl(file.content)) return error(`${path} is a binary file and cannot be text-edited.`);
        if (file && new TextEncoder().encode(file.content).byteLength > opts.maxEditBytes) {
          return error(
            `${path} is larger than the ${opts.maxEditBytes}-byte edit limit. Use an interpreter for deliberate large-file transformations. No files changed.`,
          );
        }

        const original = file?.content ?? "";
        const hasBom = original.startsWith("\uFEFF");
        const body = hasBom ? original.slice(1) : original;
        const lineEnding = editLineEnding(body);
        const normalized = body.replace(/\r\n?/g, "\n");
        const result = applyEdits(normalized, edits);
        if ("error" in result) return error(`${result.error.replace(/\.$/, "")} (in ${path}; no files changed).`);

        const content = `${hasBom ? "\uFEFF" : ""}${restoreLineEndings(result.next, lineEnding)}`;
        if (file && content === original) return error(`Edits made no changes to ${path}. No files changed.`);
        const after = { path, content, contentType: file?.contentType };
        staged.push({
          path,
          before: file,
          after,
          validation: await validateWrite(path, content, file?.contentType, opts),
          usedFuzzy: result.usedFuzzy,
          spans: result.spans,
        });
      }

      try {
        const writeResult = await source.writeBatch(staged.map(({ after }) => after));
        const mutations = Array.isArray(writeResult)
          ? writeResult
          : staged.map(({ path, before, after }) => ({
              operation: before ? ("update" as const) : ("create" as const),
              path,
              contentType: after.contentType,
              size: new TextEncoder().encode(after.content).byteLength,
            }));
        publishArtifactDelta(context, mutations);
      } catch (writeError) {
        return error(`Artifact batch commit failed: ${errorMessage(writeError)}`);
      }

      const validation = batchValidationDetails(staged);
      const editCount = parsed.edits.length;
      const fileCount = staged.length;
      const matchCount = staged.reduce((total, file) => total + file.spans, 0);
      const fuzzy = staged.some((file) => file.usedFuzzy) ? "; used normalized matching" : "";
      return text(
        JSON.stringify({
          success: true,
          message: `Applied ${editCount} edit${editCount === 1 ? "" : "s"} (${matchCount} replacement${matchCount === 1 ? "" : "s"}) across ${fileCount} file${fileCount === 1 ? "" : "s"} atomically${fuzzy}${validation?.errors?.length ? "; saved with validation errors that need a follow-up edit" : ""}.`,
          path: fileCount === 1 ? staged[0].path : undefined,
          paths: staged.map(({ path }) => path),
          text_formats: Object.fromEntries(staged.map(({ path, after }) => [path, textFormat(after.content)])),
          validation,
        }),
      );
    },
  };
}

function createDeleteTool(source: WritableFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "delete"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (_args, state) => ({ icon: Trash2, label: state.error ? "Delete failed" : "Deleted file" }),
    },
    description: `Delete a file or folder from the ${opts.spaceName} file space. Deleting a folder deletes every file below it.`,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: `The absolute virtual file or folder path in the ${opts.spaceName} file space.`,
        },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const path = typeof args.file_path === "string" ? args.file_path : "";
      if (!path) return error("file_path is required");

      const removeResult = await source.remove(path);
      const mutations = resolvedMutations(removeResult, { operation: "delete", path });
      if (mutations.length === 0) return error(`File or folder not found: ${path}`);
      publishArtifactDelta(context, mutations);
      return text(JSON.stringify({ success: true, message: `Deleted: ${path}`, path }));
    },
  };
}

function createMoveTool(source: WritableFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "move"),
    strict: SCHEMA_GUIDED,
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
    description: `Move or rename a file or folder within the ${opts.spaceName} file space.`,
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "The source file or folder path.",
        },
        to: {
          type: "string",
          description: "The destination file or folder path.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>, context?: ToolContext) => {
      const from = args.from as string;
      const to = args.to as string;
      if (!from || !to) return error("Both from and to are required");

      const file = await source.read(from);
      const moveResult = await source.move(from, to);
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

type GrepOutputMode = "content" | "files_with_matches" | "count";

interface GrepScan {
  occurrences: number;
  lineNumbers: number[];
}

const FILE_GREP_TYPES: Record<string, readonly string[]> = {
  c: ["c"],
  cpp: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++"],
  cs: ["cs"],
  csharp: ["cs"],
  css: ["css"],
  dart: ["dart"],
  go: ["go"],
  h: ["h", "hpp", "hh", "hxx"],
  html: ["htm", "html"],
  java: ["java"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  js: ["js", "jsx", "mjs", "cjs"],
  json: ["json"],
  kotlin: ["kt", "kts"],
  kt: ["kt", "kts"],
  lua: ["lua"],
  markdown: ["md", "markdown"],
  md: ["md", "markdown"],
  php: ["php"],
  py: ["py", "pyw"],
  python: ["py", "pyw"],
  rb: ["rb"],
  ruby: ["rb"],
  rs: ["rs"],
  rust: ["rs"],
  scala: ["scala", "sc"],
  sh: ["sh", "bash", "zsh"],
  sql: ["sql"],
  swift: ["swift"],
  toml: ["toml"],
  ts: ["ts", "mts", "cts"],
  tsx: ["tsx"],
  typescript: ["ts", "mts", "cts", "tsx"],
  vue: ["vue"],
  yaml: ["yaml", "yml"],
  yml: ["yaml", "yml"],
};

function nonNegativeInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function pathInScope(path: string, scope: string): boolean {
  return scope === "/" || path === scope || path.startsWith(`${scope}/`);
}

function relativePath(path: string, scope: string): string {
  if (path === scope) return path.split("/").at(-1) ?? path;
  return scope === "/" ? path.replace(/^\/+/, "") : path.slice(scope.length).replace(/^\/+/, "");
}

function pathMatchesGlob(path: string, scope: string, pattern: string): boolean {
  const relative = relativePath(path, scope);
  if (matchGlob(relative, pattern) || matchGlob(path, pattern)) return true;
  return !pattern.includes("/") && matchGlob(relative.split("/").at(-1) ?? relative, pattern);
}

function pathMatchesType(path: string, type: string): boolean {
  if (!type) return true;
  const extensions = FILE_GREP_TYPES[type];
  if (!extensions) return false;
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return extensions.includes(extension);
}

function cloneRegex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags);
}

function lineForOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

function scanText(content: string, regex: RegExp, multiline: boolean): GrepScan {
  const text = content.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const matchedLines = new Set<number>();
  let occurrences = 0;

  if (!multiline) {
    for (let index = 0; index < lines.length; index++) {
      const lineRegex = cloneRegex(regex);
      for (let match = lineRegex.exec(lines[index]); match; match = lineRegex.exec(lines[index])) {
        occurrences += 1;
        matchedLines.add(index + 1);
        if (match[0].length === 0) lineRegex.lastIndex += 1;
      }
    }
    return { occurrences, lineNumbers: [...matchedLines] };
  }

  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);

  const documentRegex = cloneRegex(regex);
  for (let match = documentRegex.exec(text); match; match = documentRegex.exec(text)) {
    occurrences += 1;
    const firstLine = lineForOffset(starts, match.index);
    const finalOffset = match[0].length > 0 ? match.index + match[0].length - 1 : match.index;
    const lastLine = lineForOffset(starts, finalOffset);
    for (let line = firstLine; line <= lastLine; line++) matchedLines.add(line);
    if (match[0].length === 0) documentRegex.lastIndex += 1;
  }
  return { occurrences, lineNumbers: [...matchedLines].sort((a, b) => a - b) };
}

function createGrepTool(source: ReadonlyFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "grep"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => ({
        icon: Search,
        label: state.error ? "Search failed" : state.running ? "Searching files…" : "Searched files",
        preview: typeof args?.pattern === "string" ? args.pattern : undefined,
      }),
    },
    description: [
      `Search file contents in the ${opts.spaceName} file space with JavaScript regular expressions and ripgrep-style options.`,
      "Use path to scope the search, glob or type to filter files, and output_mode to choose paths (default), matching content, or counts.",
      "Content mode supports -A/-B/-C context. Line numbers are on by default; omit -n unless disabling them. Flag parameter names include the leading hyphen. Set multiline only when a pattern must span lines.",
      `Search omits a leading BOM and normalizes newlines. Use ${toolName(opts, "read")}'s header or write results to inspect text format, not grep.`,
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for.",
        },
        path: {
          type: "string",
          description: 'File or directory to search. Defaults to "/".',
        },
        glob: {
          type: "string",
          description: 'Glob filter for files, such as "*.js" or "**/*.{ts,tsx}".',
        },
        type: {
          type: "string",
          description: `File type filter (${Object.keys(FILE_GREP_TYPES).join(", ")}).`,
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description: "content shows matching lines; files_with_matches (default) shows paths; count shows counts.",
          default: "files_with_matches",
        },
        "-B": {
          type: "integer",
          minimum: 0,
          description: "Lines shown before each match in content mode.",
        },
        "-A": {
          type: "integer",
          minimum: 0,
          description: "Lines shown after each match in content mode.",
        },
        "-C": {
          type: "integer",
          minimum: 0,
          description: "Lines shown before and after each match in content mode.",
        },
        "-n": {
          type: "boolean",
          description: "Show line numbers in content mode. Defaults to true.",
          default: true,
        },
        "-i": {
          type: "boolean",
          description: "Use case-insensitive matching. Defaults to false.",
          default: false,
        },
        head_limit: {
          type: "integer",
          minimum: 0,
          description: `First N result entries. Defaults to ${opts.defaultGrepLimit}; 0 returns all entries.`,
          default: opts.defaultGrepLimit,
        },
        skip: {
          type: "integer",
          minimum: 0,
          description: "Skip the first N result entries for pagination. Defaults to 0.",
          default: 0,
        },
        multiline: {
          type: "boolean",
          description: "Allow matches to span lines and make dot match newlines. Defaults to false.",
          default: false,
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      if (!pattern) return error("pattern is required");

      const searchPath = normalizeArtifactPath(typeof args.path === "string" ? args.path : "/");
      if (!searchPath) return error("path must be a valid artifact file or directory");

      const glob = typeof args.glob === "string" ? args.glob.trim() : "";
      const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "";
      if (type && !FILE_GREP_TYPES[type]) {
        return error(`unsupported type ${JSON.stringify(type)}; use ${Object.keys(FILE_GREP_TYPES).join(", ")}`);
      }

      const outputMode = (args.output_mode ?? "files_with_matches") as GrepOutputMode;
      if (!["content", "files_with_matches", "count"].includes(outputMode)) {
        return error("output_mode must be content, files_with_matches, or count");
      }

      const commonContext = nonNegativeInteger(args["-C"], 0);
      const beforeContext = nonNegativeInteger(args["-B"], commonContext ?? 0);
      const afterContext = nonNegativeInteger(args["-A"], commonContext ?? 0);
      const headLimit = nonNegativeInteger(args.head_limit, opts.defaultGrepLimit);
      const skip = nonNegativeInteger(args.skip, 0);
      if (
        commonContext === undefined ||
        beforeContext === undefined ||
        afterContext === undefined ||
        headLimit === undefined ||
        skip === undefined
      ) {
        return error("-A, -B, -C, head_limit, and skip must be non-negative integers");
      }

      const ignoreCase = args["-i"] === true;
      const showLineNumbers = args["-n"] !== false;
      const multiline = args.multiline === true;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, `g${ignoreCase ? "i" : ""}${multiline ? "s" : ""}`);
      } catch (regexError) {
        return error(`invalid regex pattern: ${errorMessage(regexError)}`);
      }

      const entries = await source.list();
      const searchEntries = entries
        .filter((entry) => pathInScope(entry.path, searchPath))
        .filter((entry) => !glob || pathMatchesGlob(entry.path, searchPath, glob))
        .filter((entry) => pathMatchesType(entry.path, type))
        .sort((a, b) => a.path.localeCompare(b.path));

      const scans: Array<{ path: string; lines: string[]; scan: GrepScan }> = [];
      for (const entry of searchEntries) {
        const file = await source.read(entry.path);
        if (!file?.content) continue;
        if (isDataUrl(file.content)) continue;
        const content = file.content.startsWith("\uFEFF") ? file.content.slice(1) : file.content;
        const scan = scanText(content, regex, multiline);
        if (scan.occurrences > 0) scans.push({ path: entry.path, lines: splitLines(content), scan });
      }

      if (scans.length === 0) return text("No matches found");

      const limit = headLimit === 0 ? Number.POSITIVE_INFINITY : headLimit;
      if (outputMode !== "content") {
        const allRows = scans.map(({ path, scan }) => (outputMode === "count" ? `${path}:${scan.occurrences}` : path));
        const rows = allRows.slice(skip, skip + limit);
        const suffix = skip + rows.length < allRows.length ? "\n(Results truncated; use skip to continue.)" : "";
        return text(`${rows.join("\n")}${suffix}`);
      }

      const matches = scans.flatMap(({ path, scan }) => scan.lineNumbers.map((lineNumber) => ({ path, lineNumber })));
      const selected = matches.slice(skip, skip + limit);
      const selectedByPath = new Map<string, Set<number>>();
      for (const match of selected) {
        const lines = selectedByPath.get(match.path) ?? new Set<number>();
        lines.add(match.lineNumber);
        selectedByPath.set(match.path, lines);
      }

      const outputLines: string[] = [];
      let anyLineTruncated = false;
      for (const { path, lines } of scans) {
        const matching = selectedByPath.get(path);
        if (!matching) continue;
        const visible = new Set<number>();
        for (const lineNumber of matching) {
          for (
            let line = Math.max(1, lineNumber - (beforeContext ?? 0));
            line <= Math.min(lines.length, lineNumber + (afterContext ?? 0));
            line++
          ) {
            visible.add(line);
          }
        }
        for (const lineNumber of [...visible].sort((a, b) => a - b)) {
          const raw = lines[lineNumber - 1] ?? "";
          const content = truncateLine(raw, opts.maxGrepLineChars);
          if (content !== raw) anyLineTruncated = true;
          const separator = matching.has(lineNumber) ? ":" : "-";
          const location = showLineNumbers ? `${path}:${lineNumber}` : path;
          outputLines.push(`${location}${separator}${content}`);
        }
      }

      const notices: string[] = [];
      if (skip + selected.length < matches.length) notices.push("Results truncated; use skip to continue");
      if (anyLineTruncated) notices.push(`Some lines truncated to ${opts.maxGrepLineChars} chars; use read`);
      const suffix = notices.length ? `\n\n[${notices.join(". ")}]` : "";
      return text(outputLines.join("\n") + suffix);
    },
  };
}

function createGlobTool(source: ReadonlyFileSource, opts: ResolvedFileToolsOptions): Tool {
  return {
    name: toolName(opts, "glob"),
    strict: SCHEMA_GUIDED,
    display: {
      header: (args, state) => ({
        icon: FileSearch,
        label: state.error ? "Glob failed" : "Found files",
        preview: typeof args?.pattern === "string" ? args.pattern : undefined,
      }),
    },
    description: `Find files in the ${opts.spaceName} file space matching a glob pattern, newest first. Use "**/*" to list every file. Use path to scope the search to one directory.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (supports *, **, ?, {a,b}).",
        },
        path: {
          type: "string",
          description: 'Virtual directory to search in, or "/" for the entire file space. Defaults to "/".',
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      if (!pattern) return error("pattern is required");
      const searchPath = normalizeArtifactPath(typeof args.path === "string" ? args.path : "/");
      if (!searchPath) return error("path must be a valid virtual directory");

      const entries = await source.list();
      if (searchPath !== "/" && !entries.some((entry) => entry.path.startsWith(`${searchPath}/`))) {
        return error(`Directory not found: ${searchPath}`);
      }
      const scoped =
        searchPath === "/"
          ? entries
          : entries.filter((entry) => entry.path === searchPath || entry.path.startsWith(`${searchPath}/`));
      const matched = scoped.filter((entry) => {
        const relative = searchPath === "/" ? entry.path.replace(/^\/+/, "") : entry.path.slice(searchPath.length + 1);
        return matchGlob(relative, pattern) || matchGlob(entry.path, pattern);
      });
      matched.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0) || a.path.localeCompare(b.path));

      const visible = matched.slice(0, opts.maxPathResults);
      const lines = visible.map((e) => {
        const size = e.size != null ? ` (${e.size}B)` : "";
        return `${e.path}${size}`;
      });
      if (visible.length < matched.length) {
        lines.push(`(Results truncated at ${opts.maxPathResults}; use a more specific path or pattern.)`);
      }

      return text([`# ${matched.length} files matching "${pattern}"`, ...lines].join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create the identical read/grep/glob contract for any logical file space. */
export function createReadonlyFileTools(source: ReadonlyFileSource, options: FileToolsOptions): Tool[] {
  const opts = resolveOptions(options);
  return [createReadTool(source, opts), createGrepTool(source, opts), createGlobTool(source, opts)];
}

/** Create mutation tools for a writable logical file space. */
export function createWritableFileTools(source: WritableFileSource, options: FileToolsOptions): Tool[] {
  const opts = resolveOptions(options);
  return [
    createWriteTool(source, opts),
    createEditTool(source, opts),
    createDeleteTool(source, opts),
    createMoveTool(source, opts),
  ];
}

/** Create the complete read-write toolset while retaining the traditional operation order. */
export function createFileTools(source: WritableFileSource, options: FileToolsOptions): Tool[] {
  const opts = resolveOptions(options);
  return [
    createReadTool(source, opts),
    createWriteTool(source, opts),
    createEditTool(source, opts),
    createDeleteTool(source, opts),
    createMoveTool(source, opts),
    createGrepTool(source, opts),
    createGlobTool(source, opts),
  ];
}
