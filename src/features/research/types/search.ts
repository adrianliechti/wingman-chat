export interface SearchResult {
  source?: string;
  title?: string;
  content: string;
  metadata?: Record<string, string>;
}
