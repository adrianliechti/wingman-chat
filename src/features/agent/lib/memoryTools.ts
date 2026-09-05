/**
 * The model-facing `memory` tool.
 *
 * One tool, one ordered batch of operations — in the spirit of JSON Patch and
 * Anthropic's single `memory` tool (view/create/str_replace/delete). The
 * always-loaded `<memory-index>` runtime context replaces a list operation;
 * everything else is an op:
 *
 *   read    { path }                  → the entry (frontmatter + body)
 *   search  { pattern }               → matching lines with their entry path
 *   write   { path, content }         → create or fully rewrite an entry
 *   write   { path, find, content }   → replace one unique passage in place
 *   remove  { path }                  → delete an entry
 *
 * Ops in one call run in order and each reports its own result, so the model
 * can read two entries, or rewrite one and remove its duplicate, in a single
 * round trip. Storage is the agent's OPFS memory bundle via {@link MemoryStore};
 * this layer enforces safe slug paths, a per-entry size cap, secret redaction,
 * and frontmatter normalization so every entry lands in the index.
 */

import { BrainCircuit } from "lucide-react";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import type { TextContent, Tool } from "@/shared/types/chat";
import { redactSecrets } from "./memoryHygiene";
import {
  deriveTitleFromPath,
  getMemoryPathError,
  isSafeMemoryPath,
  type MemoryDoc,
  type MemoryFrontmatter,
  parseMemoryDoc,
  serializeMemoryDoc,
} from "./memoryParser";
import type { MemoryStore } from "./memoryStore";

export const MEMORY_TOOL_NAME = "memory";
/** Per-entry limit for the whole file (frontmatter + body). Small entries keep reads cheap and force one topic per entry. */
export const MEMORY_ENTRY_MAX_BYTES = 4 * 1024;
/** Past this many entries, a write nudges the model to consolidate. */
export const MEMORY_CONSOLIDATE_THRESHOLD = 20;
export const MEMORY_MAX_OPS = 10;
export const MEMORY_SEARCH_MAX_MATCHES = 30;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const DEFAULT_TYPE = "Reference";

export const MEMORY_OPS = ["read", "search", "write", "remove"] as const;
export type MemoryOpName = (typeof MEMORY_OPS)[number];

export interface MemoryOp {
  op: MemoryOpName;
  path?: string;
  content?: string;
  pattern?: string;
  find?: string;
}

export type MemoryOpResult =
  | { op: "read"; path: string; content: string }
  | { op: "search"; pattern: string; matches: { path: string; line: number; text: string }[]; total: number }
  | { op: "write"; path: string; action: "created" | "updated"; note?: string }
  | { op: "remove"; path: string; action: "removed" }
  | { op: MemoryOpName; error: string; path?: string };

export interface MemoryToolsOptions {
  store: MemoryStore;
  /** Called after any successful mutation so the UI and runtime context can refresh. */
  onChange?: () => void;
}

/** Map a model-facing path ("/project-context.md", "project-context.md", "/home/user/…") to a bundle filename. */
export function toMemoryPath(virtualPath: unknown): string | undefined {
  if (typeof virtualPath !== "string") return undefined;
  const normalized = normalizeArtifactPath(virtualPath);
  if (!normalized || normalized === "/") return undefined;
  const relative = normalized.slice(1);
  return isSafeMemoryPath(relative) ? relative : undefined;
}

function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return line ? line.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
}

/**
 * Turn whatever the model wrote into a well-formed entry: frontmatter with at
 * least `type` and `title`, secrets redacted.
 */
export function prepareMemoryEntry(
  path: string,
  content: string,
): { frontmatter: Omit<MemoryFrontmatter, "timestamp">; body: string; redacted: number } {
  const redaction = redactSecrets(content);
  const fallbackTitle = deriveTitleFromPath(path);
  const parsed = parseMemoryDoc(redaction.text, fallbackTitle);

  if (!parsed) {
    // No (valid) frontmatter — wrap the text as a Reference note.
    const body = redaction.text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    return {
      frontmatter: { type: DEFAULT_TYPE, title: fallbackTitle, description: firstLine(body) },
      body,
      redacted: redaction.redacted,
    };
  }

  const { timestamp: _ignored, ...frontmatter } = parsed.frontmatter;
  return {
    frontmatter: {
      ...frontmatter,
      type: frontmatter.type.slice(0, 60),
      title: (frontmatter.title || fallbackTitle).slice(0, MAX_TITLE_LENGTH),
      description: (frontmatter.description ?? firstLine(parsed.body))?.slice(0, MAX_DESCRIPTION_LENGTH),
    },
    body: parsed.body,
    redacted: redaction.redacted,
  };
}

/** Regex search (case-insensitive; falls back to a literal match on an invalid pattern) over serialized entries. */
export function searchMemoryDocs(
  docs: { path: string; doc: MemoryDoc }[],
  pattern: string,
  maxMatches: number = MEMORY_SEARCH_MAX_MATCHES,
): { matches: { path: string; line: number; text: string }[]; total: number } {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const matches: { path: string; line: number; text: string }[] = [];
  let total = 0;
  for (const { path, doc } of docs) {
    const lines = serializeMemoryDoc(doc).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue;
      total++;
      if (matches.length < maxMatches) matches.push({ path: `/${path}`, line: i + 1, text: lines[i].trim() });
    }
  }
  return { matches, total };
}

function parseOps(args: Record<string, unknown>): MemoryOp[] | string {
  const raw = args.ops;
  if (!Array.isArray(raw) || raw.length === 0) return "ops must be a non-empty array of operations";
  if (raw.length > MEMORY_MAX_OPS) return `at most ${MEMORY_MAX_OPS} operations per call`;
  const ops: MemoryOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return "each op must be an object";
    const op = item as Record<string, unknown>;
    if (!MEMORY_OPS.includes(op.op as MemoryOpName)) {
      return `unknown op ${JSON.stringify(op.op)}; use ${MEMORY_OPS.join(", ")}`;
    }
    const str = (key: string) => (typeof op[key] === "string" ? (op[key] as string) : undefined);
    ops.push({
      op: op.op as MemoryOpName,
      path: str("path"),
      content: str("content"),
      pattern: str("pattern"),
      find: str("find"),
    });
  }
  return ops;
}

/** Human label for a call: what it mostly did, naming the entry when there is one. */
export function memoryCallLabel(
  args: Record<string, unknown> | null,
  state: { running?: boolean; error?: boolean },
): string {
  if (state.error) return "Memory failed";
  const ops = Array.isArray(args?.ops) ? (args.ops as Record<string, unknown>[]) : [];
  const kinds = new Set(ops.map((o) => o.op));
  const paths = [...new Set(ops.map((o) => toMemoryPath(o.path)).filter((p): p is string => !!p))];
  const subject =
    paths.length === 1 ? deriveTitleFromPath(paths[0]) : paths.length > 1 ? `${paths.length} entries` : "memory";

  if (kinds.size === 1) {
    const [kind] = kinds;
    if (kind === "read") return `Recalled ${subject}`;
    if (kind === "search") return "Searched memory";
    if (kind === "remove") return `Forgot ${subject}`;
    if (kind === "write") return state.running ? "Remembering…" : `Remembered ${subject}`;
  }
  return state.running ? "Updating memory…" : "Updated memory";
}

export function createMemoryTools({ store, onChange }: MemoryToolsOptions): Tool[] {
  const notify = () => onChange?.();

  async function saveEntry(path: string, content: string): Promise<{ note?: string }> {
    const prepared = prepareMemoryEntry(path, content);
    await store.write(path, prepared.frontmatter, prepared.body);
    notify();

    const notes: string[] = [];
    if (prepared.redacted > 0) {
      notes.push(
        `${prepared.redacted} credential-like value${prepared.redacted === 1 ? " was" : "s were"} redacted — never store secrets in memory.`,
      );
    }
    const count = (await store.list()).length;
    if (count > MEMORY_CONSOLIDATE_THRESHOLD) {
      notes.push(`You now have ${count} entries — consolidate related ones into a single entry where you can.`);
    }
    return { note: notes.length ? notes.join(" ") : undefined };
  }

  function checkSize(content: string): string | null {
    const size = new TextEncoder().encode(content).length;
    if (size <= MEMORY_ENTRY_MAX_BYTES) return null;
    return `Entry is ${(size / 1024).toFixed(1)}KB which exceeds the ${MEMORY_ENTRY_MAX_BYTES / 1024}KB-per-entry limit. Split it into multiple entries.`;
  }

  async function run(op: MemoryOp): Promise<MemoryOpResult> {
    switch (op.op) {
      case "read": {
        const path = toMemoryPath(op.path);
        if (!path) return { op: "read", error: `Invalid memory path: ${String(op.path)}` };
        const doc = await store.read(path);
        if (!doc) return { op: "read", path: `/${path}`, error: `No memory entry at /${path}` };
        return { op: "read", path: `/${path}`, content: serializeMemoryDoc(doc) };
      }

      case "search": {
        const pattern = op.pattern ?? "";
        if (!pattern.trim()) return { op: "search", error: "search requires a non-empty pattern" };
        return { op: "search", pattern, ...searchMemoryDocs(await store.readAll(), pattern) };
      }

      case "write": {
        const normalized = normalizeArtifactPath(op.path ?? "");
        const relative = normalized && normalized !== "/" ? normalized.slice(1) : (op.path ?? "");
        const pathError = getMemoryPathError(relative);
        if (pathError) return { op: "write", error: pathError, path: op.path };
        const virtual = `/${relative}`;
        const existing = await store.read(relative);

        let next: string;
        if (op.find) {
          // Targeted edit: replace one unique passage of the existing entry.
          if (!existing) return { op: "write", path: virtual, error: `No memory entry at ${virtual} to edit` };
          const current = serializeMemoryDoc(existing);
          const first = current.indexOf(op.find);
          if (first < 0) {
            return {
              op: "write",
              path: virtual,
              error: `find text not found in ${virtual}; read the entry and retry with exact text`,
            };
          }
          if (current.indexOf(op.find, first + op.find.length) >= 0) {
            return {
              op: "write",
              path: virtual,
              error: `find text occurs more than once in ${virtual}; include more surrounding text`,
            };
          }
          next = current.slice(0, first) + (op.content ?? "") + current.slice(first + op.find.length);
          if (!next.trim()) return { op: "write", path: virtual, error: "edit would empty the entry; use remove" };
        } else {
          next = op.content ?? "";
          if (!next.trim())
            return { op: "write", path: virtual, error: "write requires non-empty content; use remove to delete" };
        }

        const sizeError = checkSize(next);
        if (sizeError) return { op: "write", path: virtual, error: sizeError };
        const { note } = await saveEntry(relative, next);
        return { op: "write", path: virtual, action: existing ? "updated" : "created", note };
      }

      case "remove": {
        const path = toMemoryPath(op.path);
        if (!path) return { op: "remove", error: `Invalid memory path: ${String(op.path)}` };
        const removed = await store.delete(path);
        if (!removed) return { op: "remove", path: `/${path}`, error: `No memory entry at /${path}` };
        notify();
        return { op: "remove", path: `/${path}`, action: "removed" };
      }
    }
  }

  const tool: Tool = {
    name: MEMORY_TOOL_NAME,
    display: {
      header: (args, state) => ({ icon: BrainCircuit, label: memoryCallLabel(args, state), suppressPreview: true }),
      input: (args) => {
        const ops = Array.isArray(args?.ops) ? (args.ops as Record<string, unknown>[]) : [];
        return ops
          .filter((o) => typeof o.content === "string" && o.content)
          .map((o) => ({
            code: o.content as string,
            language: "markdown",
            name: typeof o.path === "string" ? o.path : undefined,
          }));
      },
    },
    description: [
      "Read, search, and update your persistent memory. Pass an ordered list of ops; each reports its own result.",
      "read {path}: the entry's frontmatter + body. search {pattern}: case-insensitive regex over all entries, returns matching lines with their path. write {path, content}: create or fully rewrite one entry; add find to replace just that one unique passage with content instead. remove {path}: delete an entry.",
      `Paths are lowercase-hyphenated like /project-context.md. Content is markdown with YAML frontmatter (type, title, description, optional tags). Max ${MEMORY_ENTRY_MAX_BYTES / 1024}KB per entry; credentials are redacted on save.`,
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          maxItems: MEMORY_MAX_OPS,
          description: "Operations to apply in order.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: [...MEMORY_OPS], description: "Operation kind." },
              path: {
                type: "string",
                description: "Entry path, e.g. /project-context.md (read, write, remove).",
              },
              content: {
                type: "string",
                description:
                  "write: the full entry (YAML frontmatter + markdown), or, with find, the replacement text.",
              },
              pattern: { type: "string", description: "search: regex to look for across entries." },
              find: {
                type: "string",
                description:
                  "write: exact existing text to replace with content; must occur exactly once. Omit to rewrite the whole entry.",
              },
            },
            required: ["op"],
            additionalProperties: false,
          },
        },
      },
      required: ["ops"],
      additionalProperties: false,
    },
    function: async (args): Promise<TextContent[]> => {
      const ops = parseOps(args);
      if (typeof ops === "string") return [{ type: "text", text: JSON.stringify({ error: ops }) }];
      const results: MemoryOpResult[] = [];
      for (const op of ops) results.push(await run(op));
      return [{ type: "text", text: JSON.stringify({ results }) }];
    },
  };

  return [tool];
}
