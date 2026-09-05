/**
 * Substring search over a set of memory docs — the read-path tool that lets the
 * model find an entry when the index alone doesn't say where a fact lives.
 * Modeled on codex's `memories.search`: multiple queries, any/all matching on a
 * line, optional context lines, bounded results.
 */

import type { MemoryDoc } from "./memoryParser";
import { serializeMemoryDoc } from "./memoryParser";

export const DEFAULT_SEARCH_MAX_RESULTS = 20;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_CONTEXT_LINES = 5;

export interface MemorySearchRequest {
  /** Substrings to look for; each must be non-empty after trimming. */
  queries: string[];
  /** `true`: every query must appear on the same line. Default: any query matches. */
  matchAll?: boolean;
  /** Default false — memory notes are prose, so case rarely matters. */
  caseSensitive?: boolean;
  /** Lines of surrounding context to include around each hit (0–5). */
  contextLines?: number;
  /** Cap on returned matches (1–50, default 20). */
  maxResults?: number;
}

export interface MemorySearchMatch {
  path: string;
  title: string;
  /** 1-indexed line within the serialized entry (frontmatter + body). */
  line: number;
  /** The matching line, trimmed. */
  text: string;
  /** The matching line plus surrounding context, when `contextLines` > 0. */
  context?: string;
}

export interface MemorySearchResult {
  matches: MemorySearchMatch[];
  /** Total hits before `maxResults` was applied. */
  total: number;
  truncated: boolean;
}

export interface SearchableMemoryDoc {
  path: string;
  doc: MemoryDoc;
}

export class MemorySearchError extends Error {}

function normalizeRequest(request: MemorySearchRequest) {
  const queries = (Array.isArray(request.queries) ? request.queries : [])
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter(Boolean);
  if (!queries.length) throw new MemorySearchError("At least one non-empty query is required");

  const contextLines = Math.min(Math.max(Math.trunc(request.contextLines ?? 0), 0), MAX_SEARCH_CONTEXT_LINES);
  const maxResults = Math.min(
    Math.max(Math.trunc(request.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS), 1),
    MAX_SEARCH_RESULTS,
  );

  return {
    queries,
    matchAll: !!request.matchAll,
    caseSensitive: !!request.caseSensitive,
    contextLines,
    maxResults,
  };
}

/** Search the given docs; results are ordered by path, then line number. */
export function searchMemoryDocs(docs: SearchableMemoryDoc[], request: MemorySearchRequest): MemorySearchResult {
  const opts = normalizeRequest(request);
  const needles = opts.caseSensitive ? opts.queries : opts.queries.map((q) => q.toLowerCase());

  const all: MemorySearchMatch[] = [];
  const sorted = [...docs].sort((a, b) => a.path.localeCompare(b.path));

  for (const { path, doc } of sorted) {
    const lines = serializeMemoryDoc(doc).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const haystack = opts.caseSensitive ? lines[i] : lines[i].toLowerCase();
      const hit = opts.matchAll
        ? needles.every((n) => haystack.includes(n))
        : needles.some((n) => haystack.includes(n));
      if (!hit) continue;

      const match: MemorySearchMatch = { path, title: doc.frontmatter.title, line: i + 1, text: lines[i].trim() };
      if (opts.contextLines > 0) {
        const start = Math.max(0, i - opts.contextLines);
        const end = Math.min(lines.length, i + opts.contextLines + 1);
        match.context = lines.slice(start, end).join("\n").trim();
      }
      all.push(match);
    }
  }

  return {
    matches: all.slice(0, opts.maxResults),
    total: all.length,
    truncated: all.length > opts.maxResults,
  };
}
