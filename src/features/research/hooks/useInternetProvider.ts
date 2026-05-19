import { Globe } from "lucide-react";
import { useMemo } from "react";
import internetInstructionsText from "@/features/research/prompts/internet.txt?raw";
import type { SearchResult } from "@/features/research/types/search";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { getTextFromContent, Role, type Tool, type ToolContext, type ToolProvider } from "@/shared/types/chat";

// Caps prevent a few full-page web_fetch results from blowing past the
// inner agent's input limit on the next turn.
const MAX_SEARCH_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_RESULT_CHARS = 1500;
const MAX_FETCH_CHARS_PER_URL = 12000;
const STATUS_QUERY_PREVIEW_CHARS = 60;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated, ${text.length - max} more chars]`;
}

function summarizeQueries(queries: string[]): string {
  if (queries.length === 1) {
    const q = queries[0];
    return q.length > STATUS_QUERY_PREVIEW_CHARS ? `${q.slice(0, STATUS_QUERY_PREVIEW_CHARS)}…` : q;
  }
  return `${queries.length} queries`;
}

function summarizeUrls(urls: string[]): string {
  if (urls.length === 1) {
    try {
      return new URL(urls[0]).hostname;
    } catch {
      return urls[0];
    }
  }
  return `${urls.length} pages`;
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

function buildWebTools(client: Client, internet: { searcher?: string; scraper?: string }, outer?: ToolContext): Tool[] {
  const tools: Tool[] = [];

  if (internet.searcher) {
    const searcher = internet.searcher;
    tools.push({
      name: "web_search",
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
      },
      function: async (args) => {
        const queries = (args.queries as string[] | undefined)?.filter((q) => typeof q === "string" && q.trim()) ?? [];
        const domains = args.domains as string[] | undefined;

        if (queries.length === 0) {
          return [{ type: "text" as const, text: "No queries provided." }];
        }

        outer?.updateMeta?.({ status: `Searching ${summarizeQueries(queries)}`, queries });

        const settled = await Promise.allSettled(queries.map((query) => client.search(searcher, query, { domains })));

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
      },
      function: async (args) => {
        const urls = (args.urls as string[] | undefined)?.filter((u) => typeof u === "string" && u.trim()) ?? [];
        if (urls.length === 0) {
          return [{ type: "text" as const, text: "No URLs provided." }];
        }

        outer?.updateMeta?.({ status: `Fetching ${summarizeUrls(urls)}`, urls });

        const settled = await Promise.allSettled(urls.map((url) => client.scrape(scraper, url)));

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

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();
  const internet = config.internet;
  const client = config.client;

  return useMemo<ToolProvider | null>(() => {
    if (!internet?.searcher && !internet?.scraper) {
      return null;
    }

    const searchAgent: Tool = {
      name: "search_agent",
      description:
        "Research the web. Provide instructions covering everything you need looked up this turn (multiple topics fine — the agent decomposes internally and runs searches in parallel). Returns curated findings with sources. **Make at most one `search_agent` call per turn**: if you have multiple research questions, put them all into a single `instructions` value rather than issuing parallel calls. The agent has no access to this conversation, so include all needed context.",
      parameters: {
        type: "object",
        properties: {
          instructions: {
            type: "string",
            description:
              "A clear, self-contained research task with all needed context. Combine every topic you need researched this turn into one instructions value — the agent decomposes internally.",
          },
        },
        required: ["instructions"],
      },
      function: async (args, context) => {
        const instructions = typeof args.instructions === "string" ? args.instructions.trim() : "";
        if (!instructions) {
          return [{ type: "text" as const, text: "Error: instructions are required" }];
        }

        const model = context?.model;
        if (!model) {
          return [{ type: "text" as const, text: "Error: no active model available" }];
        }

        if (internet?.elicitation && context?.elicit) {
          const result = await context.elicit({
            message:
              "The assistant wants to research the web. The following instructions will be sent to external search/fetch services:\n\n" +
              instructions,
          });
          if (result.action !== "accept") {
            return [{ type: "text" as const, text: "Cancelled by user." }];
          }
        }

        const innerTools = buildWebTools(client, internet, context);

        try {
          context?.updateMeta?.({ status: "Planning research…" });
          const conversation = await agentRun(
            client,
            model,
            internetInstructionsText,
            [{ role: Role.User, content: [{ type: "text", text: instructions }] }],
            innerTools,
            { options: { signal: context?.signal } },
          );
          const last = conversation[conversation.length - 1];
          const text = last ? getTextFromContent(last.content).trim() : "";
          return [{ type: "text" as const, text: text || "No answer produced." }];
        } catch (error) {
          return [
            {
              type: "text" as const,
              text: `Search agent error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ];
        }
      },
    };

    return {
      id: "internet",
      name: "Internet",
      description: "Access up-to-date information",
      icon: Globe,
      tools: [searchAgent],
    };
  }, [client, internet]);
}
