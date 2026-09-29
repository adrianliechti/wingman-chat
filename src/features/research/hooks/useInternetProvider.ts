import { Globe, Search } from "lucide-react";
import { useMemo } from "react";
import internetInstructionsText from "@/features/research/prompts/internet.txt?raw";
import type { SearchResult } from "@/features/research/types/search";
import { getConfig } from "@/shared/config";
import { createAgentTool } from "@/features/tools/lib/subagent";
import { captureRequestContext } from "@/shared/lib/requestContext";
import type { Client } from "@/shared/lib/client";
import type { Tool, ToolProvider } from "@/shared/types/chat";

// Caps prevent a few full-page web_fetch results from blowing past the
// inner agent's input limit on the next turn.
const MAX_SEARCH_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_RESULT_CHARS = 1500;
const MAX_FETCH_CHARS_PER_URL = 12000;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated, ${text.length - max} more chars]`;
}

/** Validate the canonical string-array shape without inventing aliases. */
function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected an array of strings");
  }
  return value.map((entry: string) => entry.trim()).filter(Boolean);
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "_No results found._";
  return results
    .slice(0, MAX_SEARCH_RESULTS_PER_QUERY)
    .map((r) => {
      const parts: string[] = [`### ${r.title?.trim() || "(untitled)"}`];
      if (r.source) parts.push(r.source);
      if (r.metadata) {
        const meta = Object.entries(r.metadata)
          .filter(([, v]) => v != null && String(v).trim() !== "")
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        if (meta) parts.push(meta);
      }
      const content = r.content?.trim();
      if (content) parts.push(clip(content, MAX_SEARCH_RESULT_CHARS));
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildWebTools(client: Client, internet: { searcher?: string; scraper?: string }): Tool[] {
  const tools: Tool[] = [];

  if (internet.searcher) {
    const searcher = internet.searcher;
    tools.push({
      name: "web_search",
      display: {
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
        "Fast web search. Returns markdown grouped by query, each result with title, URL, snippet, and optional metadata. Pass every related query in one call via the `queries` array.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            description: "One or more independent search queries to run in a single batch.",
            items: { type: "string" },
            minItems: 1,
          },
          domains: {
            type: "array",
            description: "Optional list of website domains to restrict ALL queries to.",
            items: { type: "string" },
          },
        },
        required: ["queries"],
        additionalProperties: false,
      },
      function: async (args, context) => {
        const queries = stringArray(args.queries);
        const domains = stringArray(args.domains);

        if (queries.length === 0) {
          return [{ type: "text" as const, text: "No queries provided." }];
        }

        const settled = await Promise.allSettled(
          queries.map((query) => client.search(searcher, query, { domains }, { signal: context?.signal })),
        );

        const blocks = settled.map((entry, i) => {
          const query = queries[i];
          const body =
            entry.status === "fulfilled"
              ? formatSearchResults(entry.value)
              : `_Error: ${entry.reason instanceof Error ? entry.reason.message : "Unknown error"}_`;
          return `## Query: ${query}\n\n${body}`;
        });

        return [{ type: "text" as const, text: blocks.join("\n\n") }];
      },
    });
  }

  if (internet.scraper) {
    const scraper = internet.scraper;
    tools.push({
      name: "web_fetch",
      display: {
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
        "Fetch the full text content of URLs you already have (e.g. from `web_search` results). Pass every URL in one call via the `urls` array.",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            description: "One or more URLs to fetch in a single batch.",
            items: { type: "string" },
            minItems: 1,
          },
        },
        required: ["urls"],
        additionalProperties: false,
      },
      function: async (args, context) => {
        const urls = stringArray(args.urls);
        if (urls.length === 0) {
          return [{ type: "text" as const, text: "No URLs provided." }];
        }

        const settled = await Promise.allSettled(
          urls.map((url) => client.scrape(scraper, url, { signal: context?.signal })),
        );

        const sections = settled.map((entry, i) => {
          const url = urls[i];
          if (entry.status === "fulfilled") {
            const content = entry.value.trim();
            if (!content) return `## ${url}\n_No text content could be extracted._`;
            return `## ${url}\n${clip(content, MAX_FETCH_CHARS_PER_URL)}`;
          }
          const message = entry.reason instanceof Error ? entry.reason.message : "Unknown error";
          return `## ${url}\nError: ${message}`;
        });

        return [{ type: "text" as const, text: sections.join("\n\n") }];
      },
    });
  }

  return tools;
}

type Config = ReturnType<typeof getConfig>;

export function createInternetProvider(client: Client, internet: Config["internet"]): ToolProvider | null {
  if (!internet?.searcher && !internet?.scraper) {
    return null;
  }

  const searchAgent = createAgentTool(
    "search_agent",
    "Research the web and return findings with sources. Provide a self-contained prompt with all topics and constraints; the researcher sees only that brief. It can search and fetch pages in parallel.",
    {
      instructions: internetInstructionsText,
      tools: buildWebTools(client, internet),
      runtimeContext: "",
      inheritHistory: false,
      middleware: [
        {
          name: "research-guard",
          async onStart(ctx) {
            const content = ctx.messages.findLast((message) => message.role === "user")?.content;
            const prompt =
              typeof content === "string"
                ? content
                : (content?.flatMap((part) => (part.type === "text" ? [part.content] : [])).join("\n") ?? "");
            let guard;
            try {
              guard = await client.guard(internet.guard ?? "", `${prompt}\n\n${captureRequestContext()}`, {
                signal: ctx.signal,
              });
            } catch (error) {
              ctx.signal?.throwIfAborted();
              throw new Error("The Guardrail system is not available. Please try again later.", { cause: error });
            }
            ctx.signal?.throwIfAborted();
            if (guard.flagged) {
              const categories = guard.categories.map((category) => category.name).join(", ");
              throw new Error(`Request blocked by content guard${categories ? ` (flagged: ${categories})` : ""}.`);
            }
          },
        },
      ],
    },
    { client, needsApproval: internet.elicitation },
  );

  return {
    id: "internet",
    name: "Web Search",
    description: "Access up-to-date information",
    icon: Globe,
    tools: [searchAgent],
  };
}

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();
  const internet = config.internet;
  const client = config.client;

  return useMemo(() => createInternetProvider(client, internet), [client, internet]);
}
