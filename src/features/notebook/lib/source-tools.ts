/**
 * Source access tools for notebooks.
 * Wraps notebook sources as a ReadableFileSource for the shared file tools.
 */

import {
  createReadOnlyFileTools,
  type FileData,
  type FileEntry,
  type ReadableFileSource,
} from "@/shared/lib/file-tools";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import type { Tool } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";

/**
 * Adapt a sources getter into a ReadableFileSource.
 * Uses a getter so freshly-created sources are visible to later tool calls
 * within the same agent run.
 */
function createSourceAdapter(getSources: () => File[]): ReadableFileSource {
  return {
    async list(): Promise<FileEntry[]> {
      return getSources().map((s) => ({
        path: s.path,
        size: s.content.length,
        contentType: s.contentType ?? inferContentTypeFromPath(s.path) ?? "text/plain",
      }));
    },

    async read(path: string): Promise<FileData | undefined> {
      const source = getSources().find((s) => s.path === path);
      if (!source) return undefined;
      // Binary sources (images, audio, etc.) are stored as data URLs.
      // Returning the raw data URL as "text" blows the model's context
      // and gets truncated mid-string by the read tool. Replace with a
      // short stub that explains how the model can actually use it.
      if (source.content.startsWith("data:")) {
        const ct = source.contentType ?? inferContentTypeFromPath(source.path) ?? "application/octet-stream";
        // Rough byte size: data URL is base64, so decoded ≈ len * 3/4
        // after the comma header.
        const commaIdx = source.content.indexOf(",");
        const b64Len = commaIdx >= 0 ? source.content.length - commaIdx - 1 : source.content.length;
        const approxBytes = Math.floor(b64Len * 0.75);
        const kb = approxBytes >= 1024 ? `${Math.round(approxBytes / 1024)} KB` : `${approxBytes} bytes`;
        const isImage = ct.startsWith("image/");
        const hint = isImage
          ? "This is a binary image source. To use it in a slide, call `import_image` with this path — do not try to read its contents."
          : "This is a binary source. Its raw contents are not meaningful as text.";
        return {
          path: source.path,
          content: `[binary source: ${ct}, ≈${kb}]\n${hint}`,
        };
      }
      return {
        path: source.path,
        content: source.content,
      };
    },
  };
}

export interface SourceToolsOptions {
  /**
   * Optional callback that creates (or overwrites) a source at the given
   * path. When provided, a `source_create` tool is added so the model can
   * save notes, summaries, or syntheses as new sources. The callback
   * receives the LLM-supplied path verbatim; normalization happens
   * downstream.
   */
  onCreate?: (path: string, content: string) => Promise<string>;
  /**
   * Optional callback that overwrites an existing source's content (used to
   * persist `source_edit` results). Receives the source's current
   * contentType so binary/text handling stays stable.
   */
  onWrite?: (path: string, content: string, contentType?: string) => Promise<void>;
  /** Optional callback to rename/move a source. Enables `source_rename`. */
  onRename?: (oldPath: string, newPath: string) => Promise<void>;
  /** Optional callback to delete a source. Enables `source_delete`. */
  onDelete?: (path: string) => Promise<void>;
}

/**
 * Create source access tools for the LLM.
 *
 * Always includes read-only tools (list/read/grep/glob). When `onCreate`
 * is supplied, additionally includes `source_create` for writing new
 * sources back to the notebook. Paths are file-system style
 * ("notes.md", "reports/q3.md"); identical paths overwrite.
 */
export function createSourceTools(getSources: () => File[], options?: SourceToolsOptions): Tool[] {
  const tools = createReadOnlyFileTools(createSourceAdapter(getSources), {
    namespace: "source_",
  });

  const ok = (message: string, extra?: Record<string, unknown>): { type: "text"; text: string }[] => [
    { type: "text" as const, text: JSON.stringify({ success: true, message, ...extra }) },
  ];
  const fail = (error: string): { type: "text"; text: string }[] => [
    { type: "text" as const, text: JSON.stringify({ error }) },
  ];
  // Coerce a tool argument to a string. A non-string (number/object the model
  // occasionally sends) becomes "" rather than crashing later `.trim()`/`.indexOf`.
  const strArg = (v: unknown): string => (typeof v === "string" ? v : "");

  if (options?.onCreate) {
    const onCreate = options.onCreate;
    tools.push({
      name: "source_create",
      description:
        "Create a new source at the given path (or overwrite if one already exists there). Use this to save notes, summaries, outlines, or syntheses the user may want to reference later. Paths are notebook-relative: `notes.md`, `reports/q3.md`. Identical paths overwrite — there is no versioning.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Notebook-relative path for the new source (e.g. `summary.md` or `research/findings.md`). Leading slashes are stripped. Must not contain `..` segments.",
          },
          content: {
            type: "string",
            description: "The full text content of the new source. Markdown is supported.",
          },
        },
        required: ["path", "content"],
      },
      function: async (args: Record<string, unknown>) => {
        const path = strArg(args.path).trim();
        const content = strArg(args.content);
        if (!path) {
          return [{ type: "text" as const, text: JSON.stringify({ error: "path is required" }) }];
        }
        if (!content.trim()) {
          return [{ type: "text" as const, text: JSON.stringify({ error: "content is required" }) }];
        }

        try {
          const id = await onCreate(path, content);
          return [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, message: `Source saved at ${id}`, path: id }),
            },
          ];
        } catch (err) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : "Failed to create source",
              }),
            },
          ];
        }
      },
    });
  }

  if (options?.onWrite) {
    const onWrite = options.onWrite;
    tools.push({
      name: "source_edit",
      description:
        "Make a targeted edit to an existing text source by replacing an exact snippet. Prefer this over source_create when refining an existing file — only the changed snippet needs to be written. `find` must match the current source text exactly (including whitespace); it must be unique in the file unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the source to edit (e.g. `notes.md`)." },
          find: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text (empty string deletes the matched text)." },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence instead of requiring a unique match (default false).",
          },
        },
        required: ["path", "find", "replace"],
      },
      function: async (args: Record<string, unknown>) => {
        const path = strArg(args.path).trim();
        const find = strArg(args.find);
        const replace = strArg(args.replace);
        const replaceAll = args.replace_all === true;

        if (!path) return fail("path is required");
        if (!find) return fail("find is required");

        const source = getSources().find((s) => s.path === path);
        if (!source) return fail(`No source at ${path} — call source_list_files to see what exists.`);
        if (source.content.startsWith("data:")) return fail(`${path} is a binary source and cannot be text-edited.`);

        const first = source.content.indexOf(find);
        if (first < 0) {
          return fail(
            `\`find\` text not found in ${path}. Earlier reads may be outdated — call source_read_file and retry with the exact current text.`,
          );
        }
        if (!replaceAll && source.content.indexOf(find, first + 1) >= 0) {
          return fail(
            `\`find\` matches multiple places in ${path}. Provide a longer, unique snippet or set replace_all: true.`,
          );
        }

        const next = replaceAll
          ? source.content.split(find).join(replace)
          : source.content.slice(0, first) + replace + source.content.slice(first + find.length);

        try {
          await onWrite(path, next, source.contentType);
          return ok(`Edited ${path} (${next.length} chars)`, { path });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "Failed to edit source");
        }
      },
    });
  }

  if (options?.onRename) {
    const onRename = options.onRename;
    tools.push({
      name: "source_rename",
      description:
        "Rename or move a source to a new path. The original extension is preserved when the new path has none.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Current source path." },
          new_path: { type: "string", description: "New source path (e.g. `archive/old-notes.md`)." },
        },
        required: ["path", "new_path"],
      },
      function: async (args: Record<string, unknown>) => {
        const path = strArg(args.path).trim();
        const newPath = strArg(args.new_path).trim();
        if (!path || !newPath) return fail("path and new_path are required");
        if (!getSources().some((s) => s.path === path)) {
          return fail(`No source at ${path} — call source_list_files to see what exists.`);
        }
        try {
          await onRename(path, newPath);
          return ok(`Renamed ${path} → ${newPath}`);
        } catch (err) {
          return fail(err instanceof Error ? err.message : "Failed to rename source");
        }
      },
    });
  }

  if (options?.onDelete) {
    const onDelete = options.onDelete;
    tools.push({
      name: "source_delete",
      description: "Delete a source from the notebook. This cannot be undone — only delete when the user asked for it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the source to delete." },
        },
        required: ["path"],
      },
      function: async (args: Record<string, unknown>) => {
        const path = strArg(args.path).trim();
        if (!path) return fail("path is required");
        if (!getSources().some((s) => s.path === path)) {
          return fail(`No source at ${path} — call source_list_files to see what exists.`);
        }
        try {
          await onDelete(path);
          return ok(`Deleted ${path}`);
        } catch (err) {
          return fail(err instanceof Error ? err.message : "Failed to delete source");
        }
      },
    });
  }

  return tools;
}
