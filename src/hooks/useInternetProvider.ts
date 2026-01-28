import { useCallback, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { getConfig } from '../config';
import type { Tool, ToolProvider } from '../types/chat';
import searchInstructionsText from '../prompts/search.txt?raw';
import researchInstructionsText from '../prompts/research.txt?raw';

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();
  const internet = config.internet;

  const isAvailable = useMemo(() => {
    try {
      return !!(internet?.searcher || internet?.scraper || internet?.researcher);
    } catch (error) {
      console.warn('Failed to get internet config:', error);
      return false;
    }
  }, [internet]);

  const client = config.client;

  const internetTools = useCallback((): Tool[] => {
    const tools: Tool[] = [];

    // If researcher is enabled, use the research API instead of individual search/scrape tools
    if (internet?.researcher) {
      tools.push({
        name: "web_research",
        description: "Performs autonomous web research based on detailed instructions. Use this for current events, recent information not in your training data, complex topics requiring multi-source analysis, or any question that needs up-to-date information from the internet. Provide clear instructions describing what to research, preferred sources, scope, and desired output format.",
        parameters: {
          type: "object",
          properties: {
            instructions: {
              type: "string",
              description: "Detailed instructions for the research task. Describe what information to find, which sources to prioritize (e.g., academic, news, official documentation), how deep to investigate, any constraints (recency, geographic focus), and what format to return results in. Write this as a prompt—be specific about scope, requirements, and expected output structure."
            }
          },
          required: ["instructions"]
        },
        function: async (args: Record<string, unknown>, context) => {
          const { instructions } = args;

          if (internet?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Research: ${(instructions as string).slice(0, 100)}${(instructions as string).length > 100 ? '...' : ''}`
            });

            if (result.action !== "accept") {
              return [{ type: 'text' as const, text: "Research cancelled by user." }];
            }
          }

          try {
            const content = await client.research(internet?.researcher || '', instructions as string);

            if (!content.trim()) {
              return [{ type: 'text' as const, text: "No research results could be generated for the given instructions." }];
            }

            return [{ type: 'text' as const, text: content }];
          } catch (error) {
            return [{ type: 'text' as const, text: `Web research failed: ${error instanceof Error ? error.message : 'Unknown error'}` }];
          }
        }
      });
    } else {
      // Add individual tools based on config flags
      if (internet?.searcher) {
        tools.push({
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

            if (internet?.elicitation && context?.elicit) {
              const result = await context.elicit({
                message: `Search the web for ${query}`
              });

              if (result.action !== "accept") {
                return [{ type: 'text' as const, text: "Search cancelled by user." }];
              }
            }

            try {
              const results = await client.search(internet?.searcher || '', query as string, {
                domains: domains as string[] | undefined
              });

              if (results.length === 0) {
                return [{ type: 'text' as const, text: "No search results found for the given query." }];
              }

              return [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }];
            } catch (error) {
              return [{ type: 'text' as const, text: `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}` }];
            }
          }
        });
      }

      if (internet?.scraper) {
        tools.push({
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

            if (internet?.elicitation && context?.elicit) {
              const result = await context.elicit({
                message: `Scrape content from ${url}`
              });

              if (result.action !== "accept") {
                return [{ type: 'text' as const, text: "Scraping cancelled by user." }];
              }
            }

            try {
              const content = await client.scrape(internet?.scraper || '', url as string);

              if (!content.trim()) {
                return [{ type: 'text' as const, text: "No text content could be extracted from the provided URL." }];
              }

              return [{ type: 'text' as const, text: content }];
            } catch (error) {
              return [{ type: 'text' as const, text: `Web scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}` }];
            }
          }
        });
      }
    }

    return tools;
  }, [client, internet]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "internet",
      name: internet?.researcher ? "Web Research" : "Web Search",
      description: "Access the internet",
      icon: Globe,
      instructions: internet?.researcher ? researchInstructionsText : searchInstructionsText,
      tools: internetTools(),
    };
  }, [isAvailable, internet?.researcher, internetTools]);

  return provider;
}
