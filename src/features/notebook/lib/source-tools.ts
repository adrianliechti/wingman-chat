/**
 * Source access tools for notebooks.
 *
 * Wraps notebook sources as a {@link ReadableFileSource} / {@link WritableFileSource}
 * for the shared file-tool factory, so the notebook chat speaks the same
 * `list/read/create/edit/delete/move/grep/glob` surface as the artifacts
 * workspace — just under a `source_` namespace. Writes route through the
 * notebook's own persistence callbacks (OPFS + React state).
 */

import {
  createFileTools,
  createReadOnlyFileTools,
  type FileData,
  type FileEntry,
  type ReadableFileSource,
  type WritableFileSource,
} from "@/shared/lib/file-tools";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import type { Tool } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";
import { normalizeSourceKey } from "./opfs-notebook";

const TOOL_NAMESPACE = "source_";

/**
 * Adapt a sources getter into a ReadableFileSource. Uses a getter so
 * freshly-created sources are visible to later tool calls within the same
 * agent run. Binary sources (images, audio, …) are stored as `data:` URLs;
 * they are returned verbatim so the shared read/edit/grep tools detect them
 * and render the standard "binary — use the Python/bash tools" notice rather
 * than dumping a multi-KB base64 blob into the model's context.
 */
function readSource(getSources: () => File[]) {
  return {
    async list(): Promise<FileEntry[]> {
      return getSources().map((s) => ({
        path: s.path,
        size: s.content.length,
        contentType: s.contentType ?? inferContentTypeFromPath(s.path) ?? "text/plain",
      }));
    },

    async read(path: string): Promise<FileData | undefined> {
      const key = normalizeSourceKey(path);
      const source = getSources().find((s) => s.path === key);
      if (!source) return undefined;
      return {
        path: source.path,
        content: source.content,
        contentType: source.contentType ?? inferContentTypeFromPath(source.path),
      };
    },
  } satisfies ReadableFileSource;
}

/** Write callbacks the notebook supplies so the chat tools can mutate sources. */
export interface SourceToolsOptions {
  /** Create or overwrite a source at the given path. Backs `source_create_file` / `source_edit_file`. */
  onWrite: (path: string, content: string, contentType?: string) => Promise<void>;
  /** Rename/move a source. Backs `source_move_file`. Throws on conflict/missing. */
  onRename: (from: string, to: string) => Promise<void>;
  /** Delete a source. Backs `source_delete_file`. */
  onDelete: (path: string) => Promise<void>;
}

/**
 * Create source access tools for the LLM, namespaced `source_`.
 *
 * Without `options` only the read-only tools are returned (list/read/grep/glob)
 * — used by output generators, which never mutate sources. With `options` the
 * full read-write surface is returned (adds create/edit/delete/move) for the
 * notebook chat. Paths are file-system style ("notes.md", "reports/q3.md");
 * identical paths overwrite.
 */
export function createSourceTools(getSources: () => File[], options?: SourceToolsOptions): Tool[] {
  const readable = readSource(getSources);

  if (!options) {
    return createReadOnlyFileTools(readable, { namespace: TOOL_NAMESPACE });
  }

  const { onWrite, onRename, onDelete } = options;
  // Canonicalize every path crossing this boundary: the shared factory's tool
  // descriptions invite a leading slash ("Should start with /"), but notebook
  // sources are keyed without one — so `/notes.md` must resolve to `notes.md`
  // rather than create a duplicate beside it.
  const writable: WritableFileSource = {
    ...readable,
    write: (path, content, contentType) => onWrite(normalizeSourceKey(path), content, contentType),
    async remove(path) {
      const key = normalizeSourceKey(path);
      if (!getSources().some((s) => s.path === key)) return false;
      await onDelete(key);
      return true;
    },
    async move(from, to) {
      const fromKey = normalizeSourceKey(from);
      if (!getSources().some((s) => s.path === fromKey)) return false;
      try {
        await onRename(fromKey, normalizeSourceKey(to));
        return true;
      } catch {
        return false;
      }
    },
  };

  return createFileTools(writable, { namespace: TOOL_NAMESPACE });
}
