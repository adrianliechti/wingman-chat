import type { RepositoryFile } from "@/features/repository/types/repository";
import { createReadonlyFileTools, type FileToolsOptions, type ReadonlyFileSource } from "@/shared/lib/file-tools";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { splitLines, truncateLine } from "@/shared/lib/text-utils";
import type { TextContent, Tool } from "@/shared/types/chat";
import type { File, FileEntry } from "@/shared/types/file";
import { reconcileRepositoryFilePaths, type ResolvedRepositoryFile } from "./repository-paths";

export interface FileChunk {
  file: RepositoryFile;
  text: string;
  similarity?: number;
  startLine?: number;
  endLine?: number;
}

type QueryChunksFunction = (query: string, topK?: number) => Promise<FileChunk[]>;

interface RepositoryToolsOptions {
  /** Results for semantic search (default: 10, maximum: 20). */
  defaultSearchResults?: number;
  /** Shared read/grep/glob limits. Primarily useful for deterministic tests. */
  fileTools?: Partial<Omit<FileToolsOptions, "namespace" | "spaceName">>;
}

const DEFAULT_SEARCH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_SNIPPET_CHARS = 400;

function textResult(text: string): TextContent[] {
  return [{ type: "text" as const, text }];
}

function errorResult(message: string): TextContent[] {
  return [{ type: "text" as const, text: JSON.stringify({ error: message }) }];
}

function pathKey(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Adapt extracted repository documents to the shared read-only file contract. */
export function createRepositoryFileSource(files: readonly RepositoryFile[]): {
  source: ReadonlyFileSource;
  files: ResolvedRepositoryFile[];
} {
  const resolved = reconcileRepositoryFilePaths(files).files;
  const readable = resolved.filter((file) => file.status === "completed" && file.text !== undefined);
  const byPath = new Map(readable.map((file) => [pathKey(file.path), file]));

  const source: ReadonlyFileSource = {
    async list(): Promise<FileEntry[]> {
      return readable.map((file) => ({
        path: file.path,
        contentType: inferContentTypeFromPath(file.path) ?? "text/plain",
        size: new TextEncoder().encode(file.text ?? "").byteLength,
        lastModified: file.uploadedAt instanceof Date ? file.uploadedAt.getTime() : new Date(file.uploadedAt).getTime(),
      }));
    },

    async read(path: string): Promise<File | undefined> {
      const normalized = normalizeArtifactPath(path);
      if (!normalized) return undefined;
      const file = byPath.get(pathKey(normalized));
      if (!file) return undefined;
      return {
        path: file.path,
        content: file.text ?? "",
        // Extracted Office/PDF content is text even though its virtual path
        // retains the source extension.
        contentType: "text/plain",
      };
    },
  };

  return { source, files: resolved };
}

function inferredChunkLines(file: RepositoryFile, chunk: string): { startLine?: number; endLine?: number } {
  if (!file.text || !chunk) return {};
  const offset = file.text.indexOf(chunk);
  if (offset < 0 || file.text.indexOf(chunk, offset + 1) >= 0) return {};
  const startLine = splitLines(file.text.slice(0, offset)).length;
  return { startLine, endLine: startLine + splitLines(chunk).length - 1 };
}

function createSearchTool(
  queryChunks: QueryChunksFunction,
  resolvedById: ReadonlyMap<string, ResolvedRepositoryFile>,
  defaultResults: number,
): Tool {
  return {
    name: "repository_search",
    description:
      "Semantic search across repository documents using natural language. Returns ranked source passages; use repository_grep for exact text or regex patterns.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A specific natural-language description of the information to find.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          default: defaultResults,
          description: `Maximum results to return. Defaults to ${defaultResults}; maximum ${MAX_SEARCH_RESULTS}.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    function: async (args: Record<string, unknown>) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return errorResult("query is required");

      const rawLimit = args.limit;
      if (
        rawLimit !== undefined &&
        (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_SEARCH_RESULTS)
      ) {
        return errorResult(`limit must be an integer from 1 to ${MAX_SEARCH_RESULTS}`);
      }
      const limit = (rawLimit as number | undefined) ?? defaultResults;

      try {
        const results = await queryChunks(query, limit);
        if (results.length === 0) return textResult(`No repository results for ${JSON.stringify(query)}`);

        const rows = results.slice(0, limit).flatMap((result, index) => {
          const file = resolvedById.get(result.file.id);
          if (!file || file.status !== "completed" || file.text === undefined) return [];
          const inferred = inferredChunkLines(file, result.text);
          const startLine = result.startLine ?? inferred.startLine;
          const endLine = result.endLine ?? inferred.endLine;
          const location = startLine
            ? `${file.path}:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ""}`
            : file.path;
          const rank = result.similarity !== undefined ? `${(result.similarity * 100).toFixed(0)}%` : `${index + 1}`;
          const snippet = truncateLine(result.text.replace(/\s+/g, " ").trim(), MAX_SEARCH_SNIPPET_CHARS);
          return [`[${rank}] ${location}: ${snippet}`];
        });

        return rows.length > 0
          ? textResult(rows.join("\n"))
          : textResult(`No repository results for ${JSON.stringify(query)}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return errorResult(`Repository search failed: ${message}`);
      }
    },
  };
}

/** Create repository_read/grep/glob from the shared core plus semantic search. */
export function createRepositoryTools(
  files: readonly RepositoryFile[],
  queryChunks: QueryChunksFunction,
  options: RepositoryToolsOptions = {},
): Tool[] {
  const { source, files: resolved } = createRepositoryFileSource(files);
  const defaultResults = Math.min(
    Math.max(options.defaultSearchResults ?? DEFAULT_SEARCH_RESULTS, 1),
    MAX_SEARCH_RESULTS,
  );
  const fileOptions: FileToolsOptions = {
    namespace: "repository",
    spaceName: "repository",
    ...options.fileTools,
  };
  const readTools = createReadonlyFileTools(source, fileOptions);
  const resolvedById = new Map(resolved.map((file) => [file.id, file]));
  return [...readTools, createSearchTool(queryChunks, resolvedById, defaultResults)];
}
