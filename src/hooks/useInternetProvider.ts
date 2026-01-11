import { useCallback, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { getConfig } from '../config';
import type { Tool, ToolProvider } from '../types/chat';
import searchInstructionsText from '../prompts/search.txt?raw';

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();

  const isAvailable = useMemo(() => {
    try {
      return !!config.internet;
    } catch (error) {
      console.warn('Failed to get search config:', error);
      return false;
    }
  }, [config.internet]);

  const client = config.client;

  const searchTools = useCallback((): Tool[] => {
    const tools: Tool[] = [
      {
        name: "web_search",
        description: "Search online if the requested information cannot be found in the language model or the information could be present in a time after the language model was trained.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The text to search online for. Search operator filters like site: are not supported."
            },
            domains: {
              type: "array",
              description: "Optional list of website domains to restrict the search to (e.g. wikipedia.org, github.com).",
              items: {
                type: "string"
              }
            }
          },
          required: ["query"]
        },
        function: async (args: Record<string, unknown>, context) => {
          const { query, domains } = args;

          if (config.internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Search the web for ${query}`
            });

            if (result.action !== "accept") {
              return "Search cancelled by user.";
            }
          }

          try {
            const results = await client.search(query as string, {
              domains: domains as string[] | undefined
            });

            if (results.length === 0) {
              return "No search results found for the given query.";
            }

            return JSON.stringify(results, null, 2);
          } catch (error) {
            return `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }
      },
      {
        name: "web_scraper",
        description: "Extracts and returns the full text content from a specific webpage. Use when you need detailed information from a known URL or to deep-dive into a page found via search.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The complete URL of the webpage to extract content from."
            }
          },
          required: ["url"]
        },
        function: async (args: Record<string, unknown>, context) => {
          const { url } = args;

          if (config.internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Scrape content from ${url}`
            });

            if (result.action !== "accept") {
              return "Scraping cancelled by user.";
            }
          }

          try {
            const content = await client.fetchText(url as string);

            if (!content.trim()) {
              return "No text content could be extracted from the provided URL.";
            }

            return content;
          } catch (error) {
            return `Web scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }
      }
    ];

    return tools;
  }, [client, config.internet?.elicitation]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "internet",
      name: "Internet",
      description: "Search and read websites",
      icon: Globe,
      instructions: searchInstructionsText,
      tools: searchTools(),
    };
  }, [isAvailable, searchTools]);

  return provider;
}
