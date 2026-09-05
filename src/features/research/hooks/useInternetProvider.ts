import { Globe, Search } from "lucide-react";
import { useMemo } from "react";
import internetInstructionsText from "@/features/research/prompts/internet.txt?raw";
import type { SearchResult } from "@/features/research/types/search";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import { captureRequestContext } from "@/shared/lib/requestContext";
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

/** Validate the canonical string-array shape without inventing aliases. */
function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected an array of strings");
  }
  return value.map((entry: string) => entry.trim()).filter(Boolean);
}

function summarizeQueries(queries: string[]): string {
  if (queries.length === 1) {
    // If the model still smuggled an array-like payload into a single string,
    // don't render the raw `[...]` to the user — show a generic label.
    const q = queries[0];
    if (q.startsWith("[") || q.includes('","')) return "the web";
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
      function: async (args) => {
        const queries = stringArray(args.queries);
        const domains = stringArray(args.domains);

        if (queries.length === 0) {
          return [{ type: "text" as const, text: "No queries provided." }];
        }

        outer?.updateMeta?.({ status: `Searching ${summarizeQueries(queries)}`, queries });

        const settled = await Promise.allSettled(
          queries.map((query) => client.search(searcher, query, { domains }, { signal: outer?.signal })),
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
      function: async (args) => {
        const urls = stringArray(args.urls);
        if (urls.length === 0) {
          return [{ type: "text" as const, text: "No URLs provided." }];
        }

        outer?.updateMeta?.({ status: `Fetching ${summarizeUrls(urls)}`, urls });

        const settled = await Promise.allSettled(
          urls.map((url) => client.scrape(scraper, url, { signal: outer?.signal })),
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
        additionalProperties: false,
      },
      function: async (args, context) => {
        const instructions = typeof args.instructions === "string" ? args.instructions.trim() : "";
        if (!instructions) {
          return [{ type: "text" as const, text: "Error: instructions are required" }];
        }

        const request = `${instructions}\n\n${captureRequestContext()}`;

        const model = context?.model;
        if (!model) {
          return [{ type: "text" as const, text: "Error: no active model available" }];
        }

        if (internet?.elicitation && context?.elicit) {
          const result = await context.elicit({
            message:
              "The assistant wants to research the web. The following instructions will be sent to external search/fetch services:\n\n" +
              request,
          });
          if (result.action !== "accept") {
            return [{ type: "text" as const, text: "Cancelled by user." }];
          }
        }

        let guard;
        try {
          guard = await client.guard(internet?.guard ?? "", request, { signal: context?.signal });
        } catch {
          return [
            {
              type: "text" as const,
              text: "The Guardrail system is not available. Please try again later.",
            },
          ];
        }

        if (guard.flagged) {
          const categories = guard.categories.map((c) => c.name).join(", ");
          return [
            {
              type: "text" as const,
              text: `Request blocked by content guard${categories ? ` (flagged: ${categories})` : ""}.`,
            },
          ];
        }

        const innerTools = buildWebTools(client, internet, context);

        try {
          context?.updateMeta?.({ status: "Planning research…" });
          const runResult = await agentRun(
            client,
            model,
            internetInstructionsText,
            [{ role: Role.User, content: [{ type: "text", text: request }] }],
            innerTools,
            {
              agentName: "research",
              invocationContext: context?.invocationContext?.fork("research"),
              options: { signal: context?.signal },
              createToolContext: () => ({ model }),
              // Nest the inner research agent under the outer execute_tool span
              // explicitly — the elicitation `await` above has already dropped
              // the active context.
              parentContext: context?.agentContext,
            },
          );
          if (runResult.status === "aborted") {
            return [{ type: "text" as const, text: "Research interrupted before finishing." }];
          }
          if (runResult.status === "failed") {
            return [
              {
                type: "text" as const,
                text: `Search agent error: ${runResult.error?.message ?? "Unknown error"}`,
              },
            ];
          }
          const conversation = runResult.messages;
          const last = conversation[conversation.length - 1];
          const text = last ? getTextFromContent(last.content).trim() : "";
          const suffix = runResult.status === "max_turns" ? "\n\n[Stopped: turn limit reached before finishing.]" : "";
          return [{ type: "text" as const, text: `${text || "No answer produced."}${suffix}` }];
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
      name: "Web Search",
      description: "Access up-to-date information",
      icon: Globe,
      tools: [searchAgent],
    };
  }, [client, internet]);
}
