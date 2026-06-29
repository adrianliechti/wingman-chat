/**
 * Shared file tool factory.
 *
 * Produces list, read, create, delete, move, grep, and glob tools that
 * operate on a pluggable data source. Both the artifacts filesystem and
 * notebook sources use this instead of duplicating tool definitions.
 */

import { FilePen, FilePlus2, FileSearch, Files, FileText, FolderInput, Search, Trash2 } from "lucide-react";
import type { TextContent, Tool } from "../types/chat";
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
}

export interface FileData {
  path: string;
  content: string;
  contentType?: string;
}

/** Read-only data source (e.g. notebook sources). */
export interface ReadableFileSource {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<FileData | undefined>;
}

/** Read-write data source (e.g. artifacts filesystem). */
export interface WritableFileSource extends ReadableFileSource {
  write(path: string, content: string, contentType?: string): Promise<void>;
  remove(path: string): Promise<boolean>;
  move(from: string, to: string): Promise<boolean>;
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
}

const DEFAULTS: Required<FileToolsOptions> = {
  maxReadLines: 500,
  maxReadChars: 50_000,
  maxGrepMatches: 20,
  maxTotalGrepMatches: 100,
  maxGrepLineChars: 200,
  defaultContextLines: 2,
  namespace: "",
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

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

function createListTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}list_files`,
    display: {
      header: (_args, state) => ({ icon: Files, label: state.error ? "List failed" : "Listed files" }),
    },
    description: "List all available files with their sizes.",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Optional directory path to filter files. If not provided, lists all files.",
        },
      },
      required: [],
    },
    function: async (args: Record<string, unknown>) => {
      const dir = (args.directory as string | undefined) ?? "/";

      const entries = await source.list();
      const filtered = !dir || dir === "/" ? entries : entries.filter((e) => e.path.startsWith(dir));
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
          type: "number",
          description: "Start line number (1-indexed). Default: 1.",
        },
        endLine: {
          type: "number",
          description: "End line number (1-indexed, inclusive).",
        },
      },
      required: ["path"],
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
        return text(
          `# ${path} (binary, ${ct})\n[Binary file — not shown as text. Use Python/bash tools to process it (the file is available in the sandbox).]`,
        );
      }

      const allLines = splitLines(content);
      const totalLines = allLines.length;

      const startLine = Math.max(1, (args.startLine as number) ?? 1);

      if (startLine > totalLines) {
        return error(`startLine ${startLine} is beyond end of file (${totalLines} lines)`);
      }

      const endLine =
        args.endLine != null
          ? Math.min(args.endLine as number, totalLines)
          : Math.min(startLine + opts.maxReadLines - 1, totalLines);

      const requestedLines = getLineRange(allLines, startLine, endLine);

      let output = requestedLines.join("\n");
      let charTruncated = false;

      if (output.length > opts.maxReadChars) {
        output = output.slice(0, opts.maxReadChars);
        charTruncated = true;
      }

      const formatted = formatLineOutput(charTruncated ? splitLines(output) : requestedLines, startLine);
      const hasMore = endLine < totalLines;
      const nextStart = endLine + 1;
      const notice = charTruncated
        ? ` [truncated at ${opts.maxReadChars} chars. Use startLine=${nextStart} to continue]`
        : hasMore
          ? ` [Use startLine=${nextStart} to continue]`
          : "";
      const header = `# ${path} (lines ${startLine}-${endLine} of ${totalLines})${notice}`;

      return text(`${header}\n${formatted}`);
    },
  };
}

function createWriteTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}create_file`,
    display: {
      header: (_args, state) => ({
        icon: FilePlus2,
        label: state.error ? "Create failed" : state.running ? "Creating file…" : "Created file",
      }),
      // Show just the file content (the path is the header preview), highlighted by extension.
      input: (args) => {
        const content = typeof args?.content === "string" ? args.content : "";
        if (!content) return [];
        const path = typeof args?.path === "string" ? args.path : undefined;
        return [{ code: content, language: path ? artifactLanguage(path) : "text" }];
      },
    },
    description: "Create a new file or update an existing file with the specified path and content.",
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
      },
      required: ["path", "content"],
    },
    function: async (args: Record<string, unknown>) => {
      const path = args.path as string;
      if (!path) return error("path is required");
      // Require a string explicitly: an empty string is a valid (empty) file, but a
      // non-string would otherwise be written verbatim through the `as string` cast.
      if (typeof args.content !== "string") return error("content is required and must be a string.");

      await source.write(path, args.content);
      return text(JSON.stringify({ success: true, message: `File created: ${path}`, path }));
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

/**
 * Normalize text so a model's snippet still matches when it drifts on whitespace
 * or punctuation: collapse NFKC, strip trailing whitespace per line, and fold
 * smart quotes, unicode dashes, and exotic spaces to their ASCII equivalents.
 * Only used as a fallback after an exact match fails.
 */
function normalizeForFuzzyMatch(s: string): string {
  let out = s
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  for (const { re, to } of FUZZY_FOLD_REGEXES) out = out.replace(re, to);
  return out;
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
 * first; if any edit misses, the whole operation retries in fuzzy-normalized
 * space (which also rewrites the untouched parts of the file to that normal form
 * — an accepted trade since the model's text already diverged from the file).
 */
function applyEdits(
  original: string,
  edits: EditOp[],
): { next: string; usedFuzzy: boolean; spans: number } | { error: string } {
  const allExact = edits.every((e) => original.includes(e.find));
  const usedFuzzy = !allExact;
  const base = usedFuzzy ? normalizeForFuzzyMatch(original) : original;
  const norm = (s: string) => (usedFuzzy ? normalizeForFuzzyMatch(s) : s);

  interface Span {
    start: number;
    end: number;
    replace: string;
    editIndex: number;
  }
  const spans: Span[] = [];
  for (let i = 0; i < edits.length; i++) {
    const find = norm(edits[i].find);
    const replace = edits[i].replace;
    if (find.length === 0) return { error: `edits[${i}].find is empty after normalization.` };

    const indices: number[] = [];
    for (let from = base.indexOf(find); from >= 0; from = base.indexOf(find, from + find.length)) {
      indices.push(from);
    }
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
    for (const start of indices) spans.push({ start, end: start + find.length, replace, editIndex: i });
  }

  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) {
      return {
        error: `edits[${spans[i - 1].editIndex}] and edits[${spans[i].editIndex}] target overlapping text. Merge them into one edit or target disjoint regions.`,
      };
    }
  }

  let next = base;
  for (let i = spans.length - 1; i >= 0; i--) {
    next = next.slice(0, spans[i].start) + spans[i].replace + next.slice(spans[i].end);
  }
  if (next === base) {
    return { error: "No changes — the replacement(s) produced identical content." };
  }
  return { next, usedFuzzy, spans: spans.length };
}

function createEditTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}edit_file`,
    display: {
      header: (args, state) => ({
        icon: FilePen,
        label: state.error ? "Edit failed" : state.running ? "Editing file…" : "Edited file",
        preview: typeof args?.path === "string" ? args.path.replace(/^\/+/, "") : undefined,
      }),
    },
    description:
      "Make targeted edits to an existing text file by replacing exact snippets. Prefer this over create_file when refining a file or building one up in steps — only the changed snippets are sent, avoiding a large re-escaped body. Pass one or more edits in `edits`; each `find` is matched against the ORIGINAL file (not applied in sequence), so the snippets must not overlap. `find` must match the current text (including whitespace) and be unique unless replace_all is true; minor whitespace/quote/dash differences are tolerated automatically.",
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
                description: "Replace every occurrence of find instead of requiring a unique match (default false).",
              },
            },
            required: ["find", "replace"],
          },
        },
      },
      required: ["path", "edits"],
    },
    function: async (args: Record<string, unknown>) => {
      const path = args.path as string;
      if (!path) return error("path is required");

      const coerced = coerceEdits(args);
      if ("error" in coerced) return error(coerced.error);

      const file = await source.read(path);
      if (!file) return error(`File not found: ${path}. Use list_files to see what exists.`);
      if (isDataUrl(file.content)) return error(`${path} is a binary file and cannot be text-edited.`);

      const result = applyEdits(file.content, coerced.edits);
      if ("error" in result) return error(`${result.error.replace(/\.$/, "")} (in ${path}).`);

      await source.write(path, result.next, file.contentType);

      const note = result.usedFuzzy ? "; matched with whitespace/punctuation normalization" : "";
      const count = `${result.spans} edit${result.spans === 1 ? "" : "s"}`;
      return text(
        JSON.stringify({
          success: true,
          message: `Applied ${count} to ${path} (${result.next.length} chars${note})`,
          path,
        }),
      );
    },
  };
}

function createDeleteTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}delete_file`,
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
      },
      required: ["path"],
    },
    function: async (args: Record<string, unknown>) => {
      const path = args.path as string;
      if (!path) return error("path is required");

      const success = await source.remove(path);
      if (!success) return error(`File or folder not found: ${path}`);
      return text(JSON.stringify({ success: true, message: `Deleted: ${path}`, path }));
    },
  };
}

function createMoveTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}move_file`,
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
      },
      required: ["from", "to"],
    },
    function: async (args: Record<string, unknown>) => {
      const from = args.from as string;
      const to = args.to as string;
      if (!from || !to) return error("Both from and to are required");

      const success = await source.move(from, to);
      if (!success) {
        return error(`Failed to move from ${from} to ${to}. Source may not exist or destination already exists.`);
      }
      return text(JSON.stringify({ success: true, message: `File moved from ${from} to ${to}`, from, to }));
    },
  };
}

function createGrepTool(source: ReadableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}grep`,
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
          description: 'Optional glob to filter files (e.g., "*.csv").',
        },
        ignoreCase: {
          type: "boolean",
          description: "Case-insensitive search. Default: true.",
        },
        contextLines: {
          type: "number",
          description: `Context lines before/after match. Default: ${opts.defaultContextLines}.`,
        },
      },
      required: ["pattern"],
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      if (!pattern) return error("pattern is required");

      const filePattern = args.filePattern as string | undefined;
      const ignoreCase = (args.ignoreCase as boolean) ?? true;
      const contextLines = (args.contextLines as number) ?? opts.defaultContextLines;

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
