/**
 * The model-facing memory tools: list, read, search, write, delete. Pure with
 * respect to storage — everything goes through a {@link MemoryStore} — so the
 * validation, redaction and response shaping here are unit-testable.
 */

import { BrainCircuit } from "lucide-react";
import type { Tool } from "@/shared/types/chat";
import { redactSecrets } from "./memoryHygiene";
import { deriveTitleFromPath, getMemoryPathError, isSafeMemoryPath } from "./memoryParser";
import { DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_RESULTS, MemorySearchError, searchMemoryDocs } from "./memorySearch";
import type { MemoryStore } from "./memoryStore";

/** Per-entry body limit. Small entries keep reads cheap and force one-topic-per-entry. */
export const MEMORY_ENTRY_MAX_BYTES = 4 * 1024;
/** Past this many entries the write response nudges the model to consolidate. */
export const MEMORY_CONSOLIDATE_THRESHOLD = 20;
/** Metadata fields are one-liners; cap them so a runaway description can't bloat the index. */
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_TAGS = 10;

export const MEMORY_TYPES = ["User Preference", "Project Context", "Decision", "Feedback", "Reference"] as const;

export interface MemoryToolsOptions {
  store: MemoryStore;
  /** Called after any successful mutation so the UI and runtime context can refresh. */
  onChange?: () => void;
}

type ToolResult = Awaited<ReturnType<Tool["function"]>>;

function text(value: string): ToolResult {
  return [{ type: "text", text: value }];
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value));
}

function error(message: string): ToolResult {
  return json({ error: message });
}

/** Human-friendly label for a memory tool call: the entry's title, else a title derived from its filename. */
export function memoryLabel(args: Record<string, unknown> | null): string {
  const title = typeof args?.title === "string" ? args.title.trim() : "";
  if (title) return title;
  const path = typeof args?.path === "string" ? args.path : "";
  return path ? deriveTitleFromPath(path) : "memory";
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parseTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = [...new Set(value.filter((t): t is string => typeof t === "string").map((t) => t.trim()))]
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  return tags.length ? tags : undefined;
}

export function createMemoryTools({ store, onChange }: MemoryToolsOptions): Tool[] {
  const notify = () => onChange?.();

  return [
    {
      name: "list_memory",
      display: {
        header: () => ({ icon: BrainCircuit, label: "Recalled memory", suppressPreview: true }),
      },
      description:
        "List every persistent memory entry (path, title, type, description, tags, last updated) without loading bodies. Prefer search_memory when you know what you're looking for.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      function: async () => json(await store.list()),
    },
    {
      name: "read_memory",
      display: {
        header: (args) => ({ icon: BrainCircuit, label: `Recalled ${memoryLabel(args)}`, suppressPreview: true }),
      },
      description: "Read one memory entry's full frontmatter and body, given its path from the index or list_memory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: 'Memory entry path, e.g. "project-context.md".' },
        },
        required: ["path"],
        additionalProperties: false,
      },
      function: async (args) => {
        const path = args.path;
        if (!isSafeMemoryPath(path)) return error(`Invalid memory path: ${String(path)}`);
        const doc = await store.read(path);
        if (!doc) return error(`No memory entry at ${path}`);
        return json({ path, ...doc.frontmatter, body: doc.body });
      },
    },
    {
      name: "search_memory",
      display: {
        header: (args) => {
          const queries = Array.isArray(args?.queries) ? args.queries.filter((q) => typeof q === "string") : [];
          return {
            icon: BrainCircuit,
            label: "Searched memory",
            preview: queries.join(", ") || undefined,
          };
        },
      },
      description:
        "Substring search across all memory entries (titles, tags, bodies). Returns matching lines with their entry path so you can read_memory the right one. Case-insensitive by default.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            description: "One or more substrings to look for, e.g. names, paths, tools, topics.",
          },
          matchAll: {
            type: "boolean",
            description: "When true, a line must contain every query. Default: any query matches.",
          },
          caseSensitive: { type: "boolean", description: "Default false." },
          contextLines: {
            type: "integer",
            description: "Lines of surrounding context to include per hit (0–5). Default 0.",
          },
          maxResults: {
            type: "integer",
            description: `Maximum matches to return (1–${MAX_SEARCH_RESULTS}). Default ${DEFAULT_SEARCH_MAX_RESULTS}.`,
          },
        },
        required: ["queries"],
        additionalProperties: false,
      },
      function: async (args) => {
        try {
          const docs = await store.readAll();
          const result = searchMemoryDocs(docs, {
            queries: args.queries as string[],
            matchAll: args.matchAll as boolean | undefined,
            caseSensitive: args.caseSensitive as boolean | undefined,
            contextLines: args.contextLines as number | undefined,
            maxResults: args.maxResults as number | undefined,
          });
          return json(result);
        } catch (err) {
          if (err instanceof MemorySearchError) return error(err.message);
          throw err;
        }
      },
    },
    {
      name: "write_memory",
      display: {
        header: (args, state) => ({
          icon: BrainCircuit,
          label: state.error ? "Couldn't remember" : state.running ? "Remembering…" : `Remembered ${memoryLabel(args)}`,
          suppressPreview: true,
        }),
        input: (args) => {
          const body = typeof args?.body === "string" ? args.body : "";
          return body ? [{ code: body, language: "markdown" }] : [];
        },
      },
      description: `Create or update one memory entry. Reuse an existing path (from the index) to update it in place, or choose a new lowercase-hyphenated path to create one. Max ${MEMORY_ENTRY_MAX_BYTES / 1024}KB per entry — split large topics across entries instead of growing one. Anything that looks like a credential is redacted before saving.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Filename for this entry, e.g. "project-context.md". Lowercase, hyphenated, ending in ".md".',
          },
          type: {
            type: "string",
            description: `Category: one of ${MEMORY_TYPES.map((t) => `"${t}"`).join(", ")}.`,
          },
          title: { type: "string", description: "Short title for this entry." },
          description: { type: "string", description: "One-line summary shown in the memory index." },
          resource: {
            type: "string",
            description: "Optional canonical URI if this entry describes an external resource.",
          },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for filtering." },
          body: { type: "string", description: "Full markdown body for this entry." },
        },
        required: ["path", "type", "title", "body"],
        additionalProperties: false,
      },
      function: async (args) => {
        const pathError = getMemoryPathError(args.path);
        if (pathError) return error(pathError);
        const path = args.path as string;

        const type = optionalString(args.type, 60);
        const title = optionalString(args.title, MAX_TITLE_LENGTH);
        const rawBody = typeof args.body === "string" ? args.body.trim() : "";
        if (!type || !title || !rawBody) return error("path, type, title, and body are required and must be non-empty");

        const byteSize = new TextEncoder().encode(rawBody).length;
        if (byteSize > MEMORY_ENTRY_MAX_BYTES) {
          return error(
            `Entry body is ${(byteSize / 1024).toFixed(1)}KB which exceeds the ${MEMORY_ENTRY_MAX_BYTES / 1024}KB-per-entry limit. Split this into multiple entries instead.`,
          );
        }

        const description = optionalString(args.description, MAX_DESCRIPTION_LENGTH);
        const resource = optionalString(args.resource, 500);
        const tags = parseTags(args.tags);

        const redaction = redactSecrets(
          [title, description ?? "", rawBody].join("\n \n"), // sentinel-joined so one pass covers all fields
        );
        const [safeTitle, safeDescription, safeBody] = redaction.text.split("\n \n");

        await store.write(
          path,
          { type, title: safeTitle, description: safeDescription || undefined, resource, tags },
          safeBody,
        );
        notify();

        const entries = await store.list();
        let response = `Memory entry "${path}" saved.`;
        if (redaction.redacted > 0) {
          response += ` ${redaction.redacted} credential-like value${redaction.redacted === 1 ? " was" : "s were"} redacted — never store secrets in memory.`;
        }
        if (entries.length > MEMORY_CONSOLIDATE_THRESHOLD) {
          response += ` You now have ${entries.length} entries — consolidate related ones into a single entry where you can.`;
        }
        return text(response);
      },
    },
    {
      name: "delete_memory",
      display: {
        header: (args) => ({ icon: BrainCircuit, label: `Forgot ${memoryLabel(args)}`, suppressPreview: true }),
      },
      description: "Delete one memory entry that is stale, wrong, or superseded by another entry.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Memory entry path to delete." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      function: async (args) => {
        const path = args.path;
        if (!isSafeMemoryPath(path)) return error(`Invalid memory path: ${String(path)}`);
        const deleted = await store.delete(path);
        if (!deleted) return error(`No memory entry at ${path}`);
        notify();
        return text(`Memory entry "${path}" deleted.`);
      },
    },
  ];
}
