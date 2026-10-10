import { z } from "zod";
import { Globe, Search } from "lucide-react";
import type { SearchCategory, SearchOptions, SearchResult } from "@/features/research/types/search";
import type { Client } from "@/shared/lib/client";
import { outputText } from "@/shared/lib/messages";
import type { Tool, ToolDisplay } from "@/shared/types/chat";
import { clip, pageExcerpt, DEFAULT_FETCH_CHARS, MAX_FETCH_CHARS } from "./webContent";
import { integer, MAX_WEB_BATCH, runCache, stringArray, webBatch } from "./webRequests";
import {
  FETCH_BUDGET_EXHAUSTED,
  MAX_TOTAL_FETCH_CHARS,
  remainingHint,
  runBudget,
  takeCall,
  type RunBudget,
} from "./researchBudget";
import { runMessages } from "@/shared/lib/agent";
import { finalText, userMessage } from "@/shared/lib/messages";

// Caps prevent a few full-page web_fetch results from blowing past the
// inner agent's input limit on the next turn.
const MAX_SEARCH_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_RESULT_CHARS = 1500;

export const RECENCY = ["day", "week", "month", "year"] as const;
export type Recency = (typeof RECENCY)[number];

export interface WebToolsConfig {
  searcher?: string;
  scraper?: string;
  /** Verticals the searcher accepts; the `category` parameter is offered only when configured. */
  categories?: SearchCategory[];
  /** Default country bias; the agent can override it per call. */
  location?: string;
  /** Optional model that condenses long fetched pages to the facts relevant to the query. */
  summarizer?: string;
}

/** Pages at or above this length go through the summarizer when one is configured. */
export const SUMMARIZE_MIN_CHARS = 4000;
const SUMMARIZE_INSTRUCTIONS =
  'You extract evidence from a fetched web page for a research task. Keep the source heading, then list every fact relevant to the question; preserve exact figures, dates, proper names and short verbatim quotes where wording matters. Keep any character-range or truncation notices verbatim. Drop navigation, ads, boilerplate and unrelated sections. If nothing on the page is relevant, reply exactly: Not relevant: <one-line reason>.';

/** Filters shared by every query of one search call. */
export interface SearchFilters {
  category?: string;
  recency?: Recency;
  since?: string;
  until?: string;
  location?: string;
  domains?: string[];
  exclude?: string[];
}

const webResultDisplay: Pick<ToolDisplay, "input" | "output"> = {
  // Queries/URLs already appear in the readable result; no argument JSON.
  input: () => [],
  output: (result) => ({ code: outputText(result), language: "markdown" }),
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Earliest publication date for a recency window, as a UTC calendar date. */
export function recencySince(recency: Recency, now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (recency) {
    case "day":
      date.setUTCDate(date.getUTCDate() - 1);
      break;
    case "week":
      date.setUTCDate(date.getUTCDate() - 7);
      break;
    case "month":
      date.setUTCMonth(date.getUTCMonth() - 1);
      break;
    case "year":
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      break;
  }
  return isoDate(date);
}

function optionalString(value: unknown, name: string, max = 64): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${name} must be a string of at most ${max} characters.`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function dateValue(value: unknown, name: string): string | undefined {
  const text = optionalString(value, name, 10);
  if (text === undefined) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  if (!ISO_DATE.test(text) || Number.isNaN(date.getTime()) || isoDate(date) !== text) {
    throw new Error(`${name} must be a calendar date formatted YYYY-MM-DD.`);
  }
  return text;
}

/** Validate shared filters and resolve them into gateway search options. */
export function searchOptions(
  args: Record<string, unknown>,
  config: Pick<WebToolsConfig, "categories" | "location">,
  now = new Date(),
): Omit<SearchOptions, "limit"> {
  const options: Omit<SearchOptions, "limit"> = {};
  // Sorted so equivalent filters share one cache entry within a run.
  const domains = stringArray(args.domains).sort();
  const exclude = stringArray(args.exclude_domains).sort();
  if (domains.length) options.domains = domains;
  if (exclude.length) options.exclude = exclude;

  const category = optionalString(args.category, "category");
  if (category) {
    const known = config.categories?.find((entry) => entry.name.toLowerCase() === category.toLowerCase());
    if (!known) {
      const names = config.categories?.map((entry) => entry.name).join(", ");
      throw new Error(names ? `Unknown category; use one of: ${names}, or omit it.` : "Categories are not supported.");
    }
    options.category = known.name;
  }

  const recency = optionalString(args.recency, "recency");
  const since = dateValue(args.since, "since");
  const until = dateValue(args.until, "until");
  if (recency !== undefined) {
    if (!RECENCY.includes(recency as Recency)) throw new Error(`recency must be one of: ${RECENCY.join(", ")}.`);
    if (since) throw new Error("Use recency or since, not both.");
    options.since = recencySince(recency as Recency, now);
  } else if (since) {
    options.since = since;
  }
  if (until) {
    if (options.since && options.since > until) throw new Error("since must not be after until.");
    options.until = until;
  }

  const location = optionalString(args.location, "location", 8) ?? config.location?.trim();
  if (location) {
    if (!/^[A-Za-z]{2}$/.test(location)) throw new Error("location must be a two-letter ISO 3166-1 country code.");
    options.location = location.toUpperCase();
  }
  return options;
}

function canonicalUrl(url: string): string {
  const trimmed = url.trim().replace(/#.*$/, "");
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "").toLowerCase();
  }
}

/**
 * Markdown for one query. URLs already listed in this call are skipped and URLs
 * shown by an earlier call in the run keep only their heading, so repeated
 * searches cost little context.
 */
function formatSearchResults(results: SearchResult[], limit: number, call: Set<string>, run: Set<string>): string {
  if (results.length === 0) return "_No results found._";
  const blocks: string[] = [];
  let omitted = 0;
  for (const r of results.slice(0, limit)) {
    const key = r.source ? canonicalUrl(r.source) : "";
    if (key && call.has(key)) {
      omitted++;
      continue;
    }
    const parts: string[] = [`### ${clip(r.title?.trim() || "(untitled)", 200)}`];
    if (r.source) parts.push(clip(r.source, 2048));
    if (key) {
      call.add(key);
      if (run.has(key)) {
        parts.push("_Listed in an earlier search._");
        blocks.push(parts.join("\n"));
        continue;
      }
      run.add(key);
    }
    if (r.metadata) {
      const { published, ...rest } = r.metadata;
      const lines: string[] = [];
      if (published?.trim()) lines.push(`Published: ${clip(published.trim(), 40)}`);
      for (const [k, v] of Object.entries(rest)) {
        if (v != null && String(v).trim() !== "") lines.push(`${k}: ${v}`);
      }
      if (lines.length) parts.push(clip(lines.join("\n"), 600));
    }
    const content = r.content?.trim();
    if (content) parts.push(clip(content, MAX_SEARCH_RESULT_CHARS));
    blocks.push(parts.join("\n"));
  }
  if (omitted) blocks.push(`_${omitted} result${omitted === 1 ? "" : "s"} already listed above omitted._`);
  return blocks.join("\n\n");
}

function describeFilters(options: Omit<SearchOptions, "limit">): string {
  const parts: string[] = [];
  if (options.category) parts.push(`category: ${options.category}`);
  if (options.since && options.until) parts.push(`published ${options.since} to ${options.until}`);
  else if (options.since) parts.push(`published since ${options.since}`);
  else if (options.until) parts.push(`published until ${options.until}`);
  if (options.location) parts.push(`location: ${options.location}`);
  if (options.domains?.length) parts.push(`domains: ${options.domains.join(", ")}`);
  if (options.exclude?.length) parts.push(`excluding: ${options.exclude.join(", ")}`);
  return parts.join(" · ");
}

function categoryDescription(categories: SearchCategory[]): string {
  const lines = categories.map((entry) =>
    entry.description?.trim() ? `${entry.name}: ${entry.description.trim()}` : entry.name,
  );
  return `Vertical to focus the search on; omit for general web questions. Options:\n${lines.join("\n")}`;
}

export function buildWebTools(client: Client, internet: WebToolsConfig): Tool[] {
  const tools: Tool[] = [];
  const searchCache = runCache<SearchResult[]>(
    (results) => results.length > 0 && JSON.stringify(results).length <= 128000,
  );
  const fetchCache = runCache<string>((text) => text.trim().length > 0 && text.length <= 256000);
  const categories = (internet.categories ?? []).filter((entry) => entry.name?.trim());
  const names = categories.map((entry) => entry.name.trim());

  if (internet.searcher) {
    const searcher = internet.searcher;
    const filters = {
      ...(names.length
        ? {
            category: z
              .enum(names as [string, ...string[]])
              .describe(categoryDescription(categories))
              .optional(),
          }
        : {}),
      recency: z
        .enum(RECENCY)
        .describe(
          "Only results published within this window. Use for news, prices, releases and other time-sensitive facts; omit for stable facts.",
        )
        .optional(),
      since: z
        .string()
        .describe("Earliest publication date, YYYY-MM-DD. Use instead of recency for a specific period.")
        .optional(),
      until: z.string().describe("Latest publication date, YYYY-MM-DD, including that whole UTC day.").optional(),
      location: z
        .string()
        .describe(
          `Two-letter country code that biases results toward that country${internet.location ? ` (default ${internet.location.toUpperCase()})` : ""}. Set for questions about a specific country or region.`,
        )
        .optional(),
      domains: z
        .array(z.string())
        .max(MAX_WEB_BATCH)
        .describe("Restrict all queries to these domains. Omit unless the sites are known; do not guess domains.")
        .optional(),
      exclude_domains: z
        .array(z.string())
        .max(MAX_WEB_BATCH)
        .describe("Drop results from these domains, e.g. sites that keep returning irrelevant pages.")
        .optional(),
    };
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
      description:
        "Search up to 8 independent queries in parallel; filters apply to every query in the call, so make separate calls for different filters. Returns titles, URLs, publication dates and excerpts.",
      inputSchema: z.strictObject({
        queries: z
          .array(z.string())
          .min(1)
          .max(MAX_WEB_BATCH)
          .describe("Focused search queries. Batch independent lookups."),
        ...filters,
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
        const limit = integer(args.limit, MAX_SEARCH_RESULTS_PER_QUERY, 1, MAX_SEARCH_RESULTS_PER_QUERY);
        const options = { ...searchOptions(args, internet), limit };

        if (queries.length === 0) {
          return [{ type: "text" as const, content: "No queries provided." }];
        }

        const signal = execution?.abortSignal ?? context?.signal;
        const budget = runBudget(signal);
        const exhausted = takeCall(budget);
        if (exhausted) return [{ type: "text" as const, content: exhausted }];
        const settled = await webBatch(
          queries,
          (query) =>
            searchCache(
              JSON.stringify([query, options, Object.keys(options).sort()]),
              () => client.search(searcher, query, options, { signal }),
              signal,
            ),
          signal,
        );

        const seen = new Set<string>();
        const blocks = settled.map((entry, i) => {
          const query = queries[i];
          const body =
            entry.status === "fulfilled"
              ? formatSearchResults(entry.value, limit, seen, budget.seen)
              : `_Error: ${entry.reason instanceof Error ? entry.reason.message : "Unknown error"}_`;
          return `## Query: ${query}\n\n${body}`;
        });
        const filters = describeFilters(options);
        if (filters) blocks.unshift(`_Filters: ${filters}_`);

        return [{ type: "text" as const, content: blocks.join("\n\n") + remainingHint(budget) }];
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

        const signal = execution?.abortSignal ?? context?.signal;
        const budget = runBudget(signal);
        const exhausted = takeCall(budget);
        if (exhausted) return [{ type: "text" as const, content: exhausted }];
        if (budget.fetchedChars >= MAX_TOTAL_FETCH_CHARS) {
          return [{ type: "text" as const, content: FETCH_BUDGET_EXHAUSTED }];
        }
        const settled = await webBatch(
          urls,
          (url) => fetchCache(url, () => client.scrape(scraper, url, { signal }), signal),
          signal,
        );

        const sections: string[] = [];
        for (const [i, entry] of settled.entries()) {
          const url = urls[i];
          if (entry.status !== "fulfilled") {
            const message = entry.reason instanceof Error ? entry.reason.message : "Unknown error";
            sections.push(`## ${url}\nError: ${message}`);
            continue;
          }
          const allowance = MAX_TOTAL_FETCH_CHARS - budget.fetchedChars;
          if (allowance <= 0) {
            sections.push(`## ${url}\n${FETCH_BUDGET_EXHAUSTED}`);
            continue;
          }
          let text = pageExcerpt(entry.value, query, offset, Math.min(maxChars, Math.max(1000, allowance)));
          if (internet.summarizer && text.length >= SUMMARIZE_MIN_CHARS) {
            text = (await summarize(client, internet.summarizer, query, `## ${url}\n${text}`, signal)) ?? text;
          }
          text = limitFetchText(text, allowance);
          budget.fetchedChars += text.length;
          sections.push(text.startsWith("## ") ? text : `## ${url}\n${text}`);
        }

        return [{ type: "text" as const, content: sections.join("\n\n") + remainingHint(budget) }];
      },
    });
  }

  return tools;
}

function limitFetchText(text: string, allowance: number): string {
  if (text.length <= allowance) return text;
  const notice = "\n[Fetch budget truncated; omitted text is not evidence.]";
  if (allowance <= notice.length) return notice.slice(0, allowance);
  return text.slice(0, allowance - notice.length) + notice;
}

/** Condense a long page to the facts relevant to the query; failures fall back to the excerpt. */
async function summarize(
  client: Client,
  model: string,
  query: string,
  page: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const question = query || "the delegated research brief; keep every substantive fact, figure, date and name";
  try {
    const messages = await runMessages(
      client,
      model,
      SUMMARIZE_INSTRUCTIONS,
      [userMessage(`Research question:\n${question}\n\nPage:\n${page}`)],
      [],
      { agentName: "web_fetch_summary", options: { signal } },
    );
    const last = messages[messages.length - 1];
    const text = last ? finalText(last).trim() : "";
    return text || undefined;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

export type { RunBudget };
