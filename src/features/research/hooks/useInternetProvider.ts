import { Globe } from "lucide-react";
import { useCallback, useMemo } from "react";
import internetInstructionsText from "@/features/research/prompts/internet.txt?raw";
import { getConfig } from "@/shared/config";
import type { Tool, ToolProvider } from "@/shared/types/chat";

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();
  const internet = config.internet;

  const isAvailable = useMemo(() => {
    try {
      return !!(internet?.searcher || internet?.scraper || internet?.researcher);
    } catch (error) {
      console.warn("Failed to get internet config:", error);
      return false;
    }
  }, [internet]);

  const client = config.client;

  const internetTools = useCallback((): Tool[] => {
    const tools: Tool[] = [];

    if (internet?.searcher) {
      tools.push({
        name: "web_search",
        description:
          "Fast web search for current information, facts, recent events, or finding relevant URLs. Ideal for real-time or volatile data like stock prices, weather, sports scores, exchange rates, and breaking news. Returns a list of results with titles, URLs, and snippets. Prefer this for quick lookups — it's significantly faster than `web_research`. Use specific keywords without filler words; avoid search operators like `site:` and use the `domains` parameter instead.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The text to search online for. Search operator filters like site: are not supported.",
            },
            domains: {
              type: "array",
              description:
                "Optional list of website domains to restrict the search to (e.g. wikipedia.org, github.com).",
              items: {
                type: "string",
              },
            },
          },
          required: ["query"],
        },
        function: async (args: Record<string, unknown>, context) => {
          const { query, domains } = args;

          if (internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Search the web for ${query}`,
            });

            if (result.action !== "accept") {
              return [{ type: "text" as const, text: "Search cancelled by user." }];
            }
          }

          try {
            const results = await client.search(internet?.searcher || "", query as string, {
              domains: domains as string[] | undefined,
            });

            if (results.length === 0) {
              return [{ type: "text" as const, text: "No search results found for the given query." }];
            }

            return [{ type: "text" as const, text: JSON.stringify(results, null, 2) }];
          } catch (error) {
            return [
              {
                type: "text" as const,
                text: `Web search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ];
          }
        },
      });
    }

    if (internet?.researcher) {
      tools.push({
        name: "web_research",
        description:
          "Slow, in-depth autonomous research across multiple sources. Prefer `web_search` for simple lookups — only use this when the question genuinely requires multi-source synthesis, comparison of viewpoints, or a comprehensive report. Expect this call to take significantly longer than a regular search. Provide detailed instructions describing the objective, scope, preferred sources, constraints, and desired output format.",
        parameters: {
          type: "object",
          properties: {
            instructions: {
              type: "string",
              description:
                "Detailed instructions for the research task. Describe what information to find, which sources to prioritize (e.g., academic, news, official documentation), how deep to investigate, any constraints (recency, geographic focus), and what format to return results in. Write this as a prompt—be specific about scope, requirements, and expected output structure.",
            },
          },
          required: ["instructions"],
        },
        function: async (args: Record<string, unknown>, context) => {
          const { instructions } = args;

          if (internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Research: ${(instructions as string).slice(0, 100)}${(instructions as string).length > 100 ? "..." : ""}`,
            });

            if (result.action !== "accept") {
              return [{ type: "text" as const, text: "Research cancelled by user." }];
            }
          }

          try {
            const content = await client.research(internet?.researcher || "", instructions as string);

            if (!content.trim()) {
              return [
                { type: "text" as const, text: "No research results could be generated for the given instructions." },
              ];
            }

            return [{ type: "text" as const, text: content }];
          } catch (error) {
            return [
              {
                type: "text" as const,
                text: `Web research failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ];
          }
        },
      });
    }

    if (internet?.scraper) {
      tools.push({
        name: "web_fetch",
        description:
          "Fetch and extract the full text content of a specific URL. Use when you already have a URL (e.g. from `web_search` results) and need the complete page contents for detailed reading.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The complete URL of the webpage to extract content from.",
            },
          },
          required: ["url"],
        },
        function: async (args: Record<string, unknown>, context) => {
          const { url } = args;

          if (internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Fetch content from ${url}`,
            });

            if (result.action !== "accept") {
              return [{ type: "text" as const, text: "Fetch cancelled by user." }];
            }
          }

          try {
            const content = await client.scrape(internet?.scraper || "", url as string);

            if (!content.trim()) {
              return [{ type: "text" as const, text: "No text content could be extracted from the provided URL." }];
            }

            return [{ type: "text" as const, text: content }];
          } catch (error) {
            return [
              {
                type: "text" as const,
                text: `Web fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ];
          }
        },
      });
    }

    return tools;
  }, [client, internet]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "internet",
      name: "Internet",
      description: "Access up-to-date information",
      icon: Globe,
      instructions: internetInstructionsText,
      tools: internetTools(),
    };
  }, [isAvailable, internetTools]);

  return provider;
}
