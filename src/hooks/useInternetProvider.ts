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
        description: "Search the web for current information, recent events, or specific facts",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The optimized search query to find relevant information on the web. Use specific keywords, remove unnecessary words, and structure the query for best search results."
            }
          },
          required: ["query"]
        },
        function: async (args: Record<string, unknown>) => {
          const { query } = args;
          
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
        name: "web_scraper",
        description: "Scrape and extract text content from a specific webpage URL",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL of the webpage to scrape and extract text content from"
            }
          },
          required: ["url"]
        },
        function: async (args: Record<string, unknown>) => {
          const { url } = args;
          
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
  }, [client]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "internet",
      name: "Internet",
      description: "Search and fetch websites",
      icon: Globe,
      instructions: searchInstructionsText,
      tools: searchTools(),
    };
  }, [isAvailable, searchTools]);

  return provider;
}
