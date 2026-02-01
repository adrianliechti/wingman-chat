/**
 * Repository file access tools.
 * Provides ls, glob, grep, read, and search tools for repository files.
 */

import type { Tool, TextContent } from '../types/chat';
import type { RepositoryFile } from '../types/repository';
import {
  splitLines,
  getLineRange,
  formatLineOutput,
  matchGlob,
  grepText,
  truncateLine,
} from './text-utils';

/**
 * Result from semantic search (queryChunks).
 */
export interface FileChunk {
  file: RepositoryFile;
  text: string;
  similarity?: number;
}

/**
 * Query function type for semantic search.
 */
export type QueryChunksFunction = (query: string, topK?: number) => Promise<FileChunk[]>;

/**
 * Options for creating repository tools.
 */
export interface RepositoryToolsOptions {
  /** Maximum grep matches per file (default: 20) */
  maxGrepMatches?: number;
  /** Maximum lines to return in read (default: 200) */
  maxReadLines?: number;
  /** Maximum characters to return in read (default: 15000) */
  maxReadChars?: number;
  /** Context lines for grep (default: 2) */
  defaultContextLines?: number;
  /** Results for semantic search (default: 10) */
  defaultSearchResults?: number;
}

const DEFAULT_OPTIONS: Required<RepositoryToolsOptions> = {
  maxGrepMatches: 20,
  maxReadLines: 200,
  maxReadChars: 15000,
  defaultContextLines: 2,
  defaultSearchResults: 10,
};

/** Maximum total grep matches across all files */
const MAX_TOTAL_GREP_MATCHES = 100;

/** Maximum characters per grep line */
const MAX_GREP_LINE_CHARS = 200;

/** Maximum characters per search result snippet */
const MAX_SEARCH_SNIPPET_CHARS = 400;

/**
 * Helper to create a plain text result response.
 */
function textResult(text: string): TextContent[] {
  return [{ type: 'text' as const, text }];
}

/**
 * Helper to create an error response (keeps JSON for structured errors).
 */
function errorResult(message: string): TextContent[] {
  return [{ type: 'text' as const, text: JSON.stringify({ error: message }) }];
}

/**
 * Format file info as a single line: "name (lines L, chars C)"
 */
function formatFileInfo(file: RepositoryFile): string {
  const text = file.text || '';
  const lines = text ? splitLines(text).length : 0;
  return `${file.name} (${lines}L, ${text.length}C)`;
}

/**
 * Create the ls (list files) tool.
 */
function createLsTool(files: RepositoryFile[]): Tool {
  return {
    name: 'repository_ls',
    description: `List all files in the repository with line/character counts.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    function: async () => {
      const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
      
      const lines = sortedFiles.map(formatFileInfo);
      const header = `# ${sortedFiles.length} files`;
      
      return textResult([header, ...lines].join('\n'));
    },
  };
}

/**
 * Create the glob (pattern match files) tool.
 */
function createGlobTool(files: RepositoryFile[]): Tool {
  return {
    name: 'repository_glob',
    description: `Find files matching a glob pattern. Examples: "**/*.ts", "src/**/*.{ts,tsx}"`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (supports *, **, ?, {a,b}).',
        },
      },
      required: ['pattern'],
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      
      if (!pattern) {
        return errorResult('Pattern is required');
      }
      
      const matchedFiles = files.filter(f => matchGlob(f.name, pattern));
      matchedFiles.sort((a, b) => a.name.localeCompare(b.name));
      
      const lines = matchedFiles.map(formatFileInfo);
      const header = `# ${matchedFiles.length} files matching "${pattern}"`;
      
      return textResult([header, ...lines].join('\n'));
    },
  };
}

/**
 * Create the grep (regex search) tool.
 */
function createGrepTool(
  files: RepositoryFile[],
  options: Required<RepositoryToolsOptions>
): Tool {
  return {
    name: 'repository_grep',
    description: `Search for a regex pattern across files. Returns matching lines with context. Examples: "function\\s+\\w+", "TODO|FIXME"`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for.',
        },
        filePattern: {
          type: 'string',
          description: 'Glob to filter files (e.g., "*.ts").',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case-insensitive search. Default: true.',
        },
        contextLines: {
          type: 'number',
          description: 'Context lines before/after match. Default: 2.',
        },
      },
      required: ['pattern'],
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      const filePattern = args.filePattern as string | undefined;
      const ignoreCase = (args.ignoreCase as boolean) ?? true;
      const contextLines = (args.contextLines as number) ?? options.defaultContextLines;
      const maxMatches = options.maxGrepMatches;
      
      if (!pattern) {
        return errorResult('Pattern is required');
      }
      
      // Filter to completed files
      let searchFiles = files.filter(f => f.status === 'completed' && f.text);
      
      // Apply file pattern filter
      if (filePattern) {
        searchFiles = searchFiles.filter(f => matchGlob(f.name, filePattern));
      }
      
      const outputLines: string[] = [];
      let totalMatches = 0;
      let currentFile = '';
      
      for (const file of searchFiles) {
        if (totalMatches >= MAX_TOTAL_GREP_MATCHES) break;
        
        const text = file.text || '';
        const { matches } = grepText(text, pattern, {
          ignoreCase,
          maxMatches,
          contextLines,
        });
        
        if (matches.length > 0) {
          for (const m of matches) {
            if (totalMatches >= MAX_TOTAL_GREP_MATCHES) break;
            // Format: filename:lineNum: content (or filename:lineNum- for context)
            const prefix = m.isContext ? '-' : ':';
            const line = truncateLine(m.content, MAX_GREP_LINE_CHARS);
            // Only show filename on first match or when file changes
            if (file.name !== currentFile) {
              currentFile = file.name;
              outputLines.push(`${file.name}:${m.lineNumber}${prefix}${line}`);
            } else {
              outputLines.push(`${m.lineNumber}${prefix}${line}`);
            }
            if (!m.isContext) totalMatches += 1;
          }
        }
      }

      const truncated = totalMatches >= MAX_TOTAL_GREP_MATCHES;
      const header = `# ${totalMatches} matches in ${searchFiles.length} files${truncated ? ' (limit reached)' : ''}`;
      
      return textResult([header, ...outputLines].join('\n'));
    },
  };
}

/**
 * Create the read (read file content) tool.
 */
function createReadTool(
  files: RepositoryFile[],
  options: Required<RepositoryToolsOptions>
): Tool {
  return {
    name: 'repository_read',
    description: `Read file content with line numbers. Use startLine/endLine for large files.`,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: 'The name of the file to read (as shown in repository_ls output).',
        },
        startLine: {
          type: 'number',
          description: 'Start line number (1-indexed). Default: 1.',
        },
        endLine: {
          type: 'number',
          description: `End line number (1-indexed, inclusive). Default: ${options.maxReadLines} lines from start or end of file.`,
        },
      },
      required: ['fileName'],
    },
    function: async (args: Record<string, unknown>) => {
      const fileName = args.fileName as string;
      const startLine = (args.startLine as number) ?? 1;
      const endLine = args.endLine as number | undefined;
      
      if (!fileName) {
        return errorResult('fileName is required');
      }
      
      // Find the file (case-insensitive)
      const file = files.find(f => 
        f.name.toLowerCase() === fileName.toLowerCase() && 
        f.status === 'completed'
      );
      
      if (!file) {
        // Try partial match
        const partialMatches = files
          .filter(f => f.status === 'completed' && f.name.toLowerCase().includes(fileName.toLowerCase()))
          .map(f => f.name)
          .slice(0, 5);
        
        if (partialMatches.length > 0) {
          return errorResult(`File "${fileName}" not found. Did you mean: ${partialMatches.join(', ')}?`);
        }
        return errorResult(`File "${fileName}" not found in repository.`);
      }
      
      const text = file.text || '';
      if (!text) {
        return textResult(`# ${file.name} (0 lines)\n[empty file]`);
      }
      
      const allLines = splitLines(text);
      const totalLines = allLines.length;
      const safeStartLine = Math.max(1, startLine);
      
      // Determine actual end line
      const actualEndLine = endLine !== undefined
        ? Math.min(endLine, totalLines)
        : Math.min(safeStartLine + options.maxReadLines - 1, totalLines);
      
      // Get the requested lines
      const requestedLines = getLineRange(allLines, safeStartLine, actualEndLine);
      
      // Check character limit
      let content = requestedLines.join('\n');
      let charTruncated = false;
      
      if (content.length > options.maxReadChars) {
        // Truncate by character count
        content = content.slice(0, options.maxReadChars);
        charTruncated = true;
      }
      
      // Format with line numbers
      const formattedContent = formatLineOutput(
        charTruncated ? splitLines(content) : requestedLines, 
        safeStartLine
      );

      const hasMore = actualEndLine < totalLines;
      const truncatedNotice = charTruncated ? ' [truncated]' : (hasMore ? ` [continues to line ${totalLines}]` : '');
      const header = `# ${file.name} (lines ${safeStartLine}-${actualEndLine} of ${totalLines})${truncatedNotice}`;
      
      return textResult(`${header}\n${formattedContent}`);
    },
  };
}

/**
 * Create the search (semantic search) tool.
 */
function createSearchTool(
  queryChunks: QueryChunksFunction,
  options: Required<RepositoryToolsOptions>
): Tool {
  return {
    name: 'repository_search',
    description: `Semantic search using natural language. Returns code chunks ranked by similarity. Use grep for exact patterns.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what you\'re looking for. Be descriptive and specific.',
        },
        limit: {
          type: 'number',
          description: `Maximum number of results to return. Default: ${options.defaultSearchResults}.`,
        },
      },
      required: ['query'],
    },
    function: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const limit = Math.min((args.limit as number) ?? options.defaultSearchResults, 20);
      
      if (!query || !query.trim()) {
        return errorResult('Query is required');
      }
      
      try {
        const results = await queryChunks(query.trim(), limit);
        
        if (results.length === 0) {
          return textResult(`# No results for "${query}"`);
        }
        
        // Format: [similarity] filename: snippet
        const outputLines = results.map((result, index) => {
          const sim = result.similarity !== undefined ? `[${(result.similarity * 100).toFixed(0)}%]` : `[${index + 1}]`;
          const snippet = truncateLine(result.text, MAX_SEARCH_SNIPPET_CHARS).replace(/\n/g, ' ');
          return `${sim} ${result.file.name}: ${snippet}`;
        });
        
        const header = `# ${results.length} results for "${query}"`;
        return textResult([header, ...outputLines].join('\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return errorResult(`Search failed: ${message}`);
      }
    },
  };
}

/**
 * Create all repository file access tools.
 * 
 * @param files - Array of repository files to operate on
 * @param queryChunks - Function for semantic search (from useRepository hook)
 * @param options - Optional configuration options
 * @returns Array of tools
 */
export function createRepositoryTools(
  files: RepositoryFile[],
  queryChunks: QueryChunksFunction,
  options: RepositoryToolsOptions = {}
): Tool[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return [
    createLsTool(files),
    createGlobTool(files),
    createGrepTool(files, opts),
    createReadTool(files, opts),
    createSearchTool(queryChunks, opts),
  ];
}

/**
 * Get the instructions for repository tools.
 */
// Tool instructions are provided via prompts/repository.txt
