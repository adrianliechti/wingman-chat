export interface SearchResult {
  source?: string;
  title?: string;
  content: string;
  metadata?: Record<string, string>;
}

/** A searcher vertical the gateway accepts as `category`, e.g. news or publication. */
export interface SearchCategory {
  name: string;
  description?: string;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict results to these domains. */
  domains?: string[];
  /** Drop results from these domains. */
  exclude?: string[];
  category?: string;
  /** ISO 3166-1 alpha-2 country code that biases results. */
  location?: string;
  /** UTC publication date bounds as YYYY-MM-DD; until includes the whole day. */
  since?: string;
  until?: string;
}
