import { useCallback, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { getConfig } from '../config';
import type { Tool, ToolProvider } from '../types/chat';
import searchInstructionsText from '../prompts/search.txt?raw';

export function useInternetProvider(): ToolProvider | null {
  const config = getConfig();
  
  const isAvailable = useMemo(() => {
    try {
      return config.internet.enabled;
    } catch (error) {
      console.warn('Failed to get search config:', error);
      return false;
    }
  }, [config.internet.enabled]);

  const client = config.client;

  const searchTools = useCallback((): Tool[] => {
    return [
      {
        name: "web_search",
        description: "Performs a quick web search to find current information, recent events, or specific facts. Best for simple lookups, fact-checking, and finding URLs to specific resources.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "A concise search query using specific keywords. Remove filler words and focus on key terms."
            }
          },
          required: ["query"]
        },
        function: async (args: Record<string, unknown>, context) => {
          const { query } = args;
          
          if (config.internet.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Search the web for ${query}`
            });

            if (result.action !== "accept") {
              return "Search cancelled by user.";
            }
          }

          try {
            const results = await client.search(query as string);
            
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
        name: "web_research",
        description: "Performs deep web research with smart query expansion, returning comprehensive results in natural language. Best for complex topics requiring multiple sources and thorough analysis.",
        parameters: {
          type: "object",
          properties: {
            instructions: {
              type: "string",
              description: "A clear, atomic description of what information to find. Focus on one specific topic or question per request."
            }
          },
          required: ["instructions"]
        },
        function: async (args: Record<string, unknown>, context) => {
          const { instructions } = args;
          
          if (config.internet.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Perform deep web research: ${instructions}`
            });

            if (result.action !== "accept") {
              return "Research cancelled by user.";
            }
          }

          try {
            const content = await client.research(instructions as string);
            
            if (!content.trim()) {
              return "No research results could be found for the given instructions.";
            }

            return content;
          } catch (error) {
            return `Web research failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
          
          if (config.internet.elicitation && context?.elicit) {
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
  }, [client, config.internet.elicitation]);

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
