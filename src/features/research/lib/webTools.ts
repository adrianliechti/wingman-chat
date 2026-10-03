import { z } from "zod";
import { Globe, Search } from "lucide-react";
import type { SearchResult } from "@/features/research/types/search";
import type { Client } from "@/shared/lib/client";
import { outputText } from "@/shared/lib/messages";
import type { Tool, ToolDisplay } from "@/shared/types/chat";
import { clip, pageExcerpt, DEFAULT_FETCH_CHARS, MAX_FETCH_CHARS } from "./webContent";
import { integer, MAX_WEB_BATCH, runCache, stringArray, webBatch } from "./webRequests";

// Caps prevent a few full-page web_fetch results from blowing past the
// inner agent's input limit on the next turn.
const MAX_SEARCH_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_RESULT_CHARS = 1500;

const webResultDisplay: Pick<ToolDisplay, "input" | "output"> = {
  // Queries/URLs already appear in the readable result; no argument JSON.
  input: () => [],
  output: (result) => ({ code: outputText(result), language: "markdown" }),
};

function formatSearchResults(results: SearchResult[], limit: number): string {
  if (results.length === 0) return "_No results found._";
  return results
    .slice(0, limit)
    .map((r) => {
      const parts: string[] = [`### ${clip(r.title?.trim() || "(untitled)", 200)}`];
      if (r.source) parts.push(clip(r.source, 2048));
      if (r.metadata) {
        const meta = Object.entries(r.metadata)
          .filter(([, v]) => v != null && String(v).trim() !== "")
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        if (meta) parts.push(clip(meta, 600));
      }
      const content = r.content?.trim();
      if (content) parts.push(clip(content, MAX_SEARCH_RESULT_CHARS));
      return parts.join("\n");
    })
    .join("\n\n");
}

export function buildWebTools(client: Client, internet: { searcher?: string; scraper?: string }): Tool[] {
  const tools: Tool[] = [];
  const searchCache = runCache<SearchResult[]>(
    (results) => results.length > 0 && JSON.stringify(results).length <= 128000,
  );
  const fetchCache = runCache<string>((text) => text.trim().length > 0 && text.length <= 256000);

  if (internet.searcher) {
    const searcher = internet.searcher;
    tools.push({
      name: "web_search",
      display: {
        ...webResultDisplay,
        header: (args, state) => {
          const queries = args?.queries;
          return {
            icon: Search,
            label: state.error ? "Search failed" : state.running ? "Searching the web…" : "Searched the web",
            preview: Array.isArray(queries)
              ? queries.filter((q): q is string => typeof q === "string").join(", ")
              : undefined,
          };
        },
      },
      description: "Search up to 8 independent queries in parallel. Returns titles, URLs, snippets and metadata.",
      inputSchema: z.strictObject({
        queries: z
          .array(z.string())
          .min(1)
          .max(MAX_WEB_BATCH)
          .describe("Focused search queries. Batch independent lookups."),
        domains: z
          .array(z.string())
          .max(MAX_WEB_BATCH)
          .describe("Restrict all queries to these domains. Omit unless the sites are known; do not guess domains.")
          .optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_RESULTS_PER_QUERY)
          .describe("Results per query: 1–8 (default 8).")
          .optional(),
      }),
      execute: async (args, execution) => {
        const context = execution?.context;
        const queries = stringArray(args.queries);
        const domains = stringArray(args.domains);
        const limit = integer(args.limit, MAX_SEARCH_RESULTS_PER_QUERY, 1, MAX_SEARCH_RESULTS_PER_QUERY);

        if (queries.length === 0) {
          return [{ type: "text" as const, content: "No queries provided." }];
        }

        const signal = context?.signal;
        const settled = await webBatch(
          queries,
          (query) =>
            searchCache(
              JSON.stringify([query, [...domains].sort(), limit]),
              () => client.search(searcher, query, { domains, limit }, { signal }),
              signal,
            ),
          signal,
        );

        const blocks = settled.map((entry, i) => {
          const query = queries[i];
          const body =
            entry.status === "fulfilled"
              ? formatSearchResults(entry.value, limit)
              : `_Error: ${entry.reason instanceof Error ? entry.reason.message : "Unknown error"}_`;
          return `## Query: ${query}\n\n${body}`;
        });

        return [{ type: "text" as const, content: blocks.join("\n\n") }];
      },
    });
  }

  if (internet.scraper) {
    const scraper = internet.scraper;
    tools.push({
      name: "web_fetch",
      display: {
        ...webResultDisplay,
        header: (args, state) => {
          const urls = args?.urls;
          return {
            icon: Globe,
            label: state.error ? "Fetch failed" : state.running ? "Fetching…" : "Fetched",
            preview: Array.isArray(urls)
              ? urls.filter((u): u is string => typeof u === "string").join(", ")
              : undefined,
          };
        },
      },
      description:
        "Read up to 8 URLs in parallel. Returns verbatim excerpts; fetched pages are reused within this run.",
      inputSchema: z.strictObject({
        urls: z.array(z.string()).min(1).max(MAX_WEB_BATCH).describe("Known URLs to read."),
        query: z.string().max(500).describe("Keywords to select relevant passages anywhere on each page.").optional(),
        offset: z
          .number()
          .int()
          .min(0)
          .describe("Character offset for sequential reading (default 0). Omit when using query.")
          .optional(),
        max_chars: z
          .number()
          .int()
          .min(1000)
          .max(MAX_FETCH_CHARS)
          .describe("Source characters per URL: 1000–12000 (default 6000).")
          .optional(),
      }),
      execute: async (args, execution) => {
        const context = execution?.context;
        const urls = stringArray(args.urls);
        if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 500)) {
          throw new Error("query must be a string of at most 500 characters.");
        }
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const maxChars = integer(args.max_chars, DEFAULT_FETCH_CHARS, 1000, MAX_FETCH_CHARS);
        if (query && offset) throw new Error("Use query or offset, not both.");
        if (urls.length === 0) {
          return [{ type: "text" as const, content: "No URLs provided." }];
        }

        const signal = context?.signal;
        const settled = await webBatch(
          urls,
          (url) => fetchCache(url, () => client.scrape(scraper, url, { signal }), signal),
          signal,
        );

        const sections = settled.map((entry, i) => {
          const url = urls[i];
          if (entry.status === "fulfilled") {
            return `## ${url}\n${pageExcerpt(entry.value, query, offset, maxChars)}`;
          }
          const message = entry.reason instanceof Error ? entry.reason.message : "Unknown error";
          return `## ${url}\nError: ${message}`;
        });

        return [{ type: "text" as const, content: sections.join("\n\n") }];
      },
    });
  }

  return tools;
}
