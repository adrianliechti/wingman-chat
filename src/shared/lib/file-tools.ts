/**
 * Shared file tool factory.
 *
 * Produces list, read, create, delete, move, grep, and glob tools that
 * operate on a pluggable data source. Both the artifacts filesystem and
 * notebook sources use this instead of duplicating tool definitions.
 */

import type { TextContent, Tool } from "../types/chat";
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
      const content = args.content as string;
      if (!path || content == null) return error("path and content are required");

      await source.write(path, content);
      return text(JSON.stringify({ success: true, message: `File created: ${path}`, path }));
    },
  };
}

function createDeleteTool(source: WritableFileSource, opts: Required<FileToolsOptions>): Tool {
  return {
    name: `${opts.namespace}delete_file`,
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
 * Returns: list_files, read_file, create_file, delete_file, move_file, grep, glob
 */
export function createFileTools(source: WritableFileSource, options?: FileToolsOptions): Tool[] {
  const opts = { ...DEFAULTS, ...options };
  return [
    createListTool(source, opts),
    createReadTool(source, opts),
    createWriteTool(source, opts),
    createDeleteTool(source, opts),
    createMoveTool(source, opts),
    createGrepTool(source, opts),
    createGlobTool(source, opts),
  ];
}
