import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { SearchContext } from "./SearchContext";
import type { SearchContextType } from "./SearchContext";
import type { Tool } from "../types/chat";
import { getConfig } from "../config";

interface SearchProviderProps {
  children: ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [isEnabled, setEnabled] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const config = getConfig();
  const client = config.client;

  // Check search availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.internet.enabled);
    } catch (error) {
      console.warn('Failed to get search config:', error);
      setIsAvailable(false);
    }
  }, []);

  const searchTools = useCallback((): Tool[] => {
    if (!isEnabled) {
      return [];
    }

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
          
          console.log("[web_search] Starting search", { query });
          
          try {
            const results = await client.search(query as string);
            
            console.log("[web_search] Search completed successfully", { query, resultsCount: results.length });
            
            if (results.length === 0) {
              return "No search results found for the given query.";
            }

            return JSON.stringify(results, null, 2);
          } catch (error) {
            console.error("[web_search] Search failed", { query, error: error instanceof Error ? error.message : error });
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
          
          console.log("[web_scraper] Starting scrape", { url });
          
          try {
            const content = await client.fetchText(url as string);
            
            console.log("[web_scraper] Scrape completed successfully", { url, contentLength: content.length });
            
            if (!content.trim()) {
              return "No text content could be extracted from the provided URL.";
            }

            return content;
          } catch (error) {
            console.error("[web_scraper] Scrape failed", { url, error: error instanceof Error ? error.message : error });
            return `Web scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }
      }
    ];
  }, [isEnabled, client]);

  const searchInstructions = useCallback((): string => {
    if (!isEnabled) {
      return "";
    }

    return `
      You have access to web search and web scraping functionality.
      
      - Use the web_search tool when you need current information, recent events, or specific facts that may not be in your training data.
      - Optimize your search queries by using specific keywords, removing unnecessary words, and structuring them for best results.
      - Use the web_scraper tool when you need to extract the full text content from a specific webpage URL.
      
      Always search when the user asks for recent information, current events, or specific factual data.
    `.trim();
  }, [isEnabled]);

  const contextValue: SearchContextType = {
    isEnabled,
    setEnabled,
    isAvailable,
    searchTools,
    searchInstructions,
  };

  return (
    <SearchContext.Provider value={contextValue}>
      {children}
    </SearchContext.Provider>
  );
}
