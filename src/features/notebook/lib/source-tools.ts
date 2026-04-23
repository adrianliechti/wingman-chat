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
import type { Tool } from "@/shared/types/chat";
import type { NotebookSource } from "../types/notebook";

/**
 * Adapt a sources getter into a ReadableFileSource.
 * Uses a getter so freshly-created sources are visible to later tool calls
 * within the same agent run.
 */
function createSourceAdapter(getSources: () => NotebookSource[]): ReadableFileSource {
  return {
    async list(): Promise<FileEntry[]> {
      return getSources().map((s) => ({
        path: s.id,
        size: s.content.length,
        contentType: s.type === "web" ? "text/html" : "text/plain",
      }));
    },

    async read(path: string): Promise<FileData | undefined> {
      const source = getSources().find((s) => s.id === path);
      if (!source) return undefined;
      return {
        path: source.id,
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
}

/**
 * Create source access tools for the LLM.
 *
 * Always includes read-only tools (list/read/grep/glob). When `onCreate`
 * is supplied, additionally includes `source_create` for writing new
 * sources back to the notebook. Paths are file-system style
 * ("notes.md", "reports/q3.md"); identical paths overwrite.
 */
export function createSourceTools(getSources: () => NotebookSource[], options?: SourceToolsOptions): Tool[] {
  const tools = createReadOnlyFileTools(createSourceAdapter(getSources), {
    namespace: "source_",
  });

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
        const path = ((args.path as string) ?? "").trim();
        const content = (args.content as string) ?? "";
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

  return tools;
}
