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
  getExtension,
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
  /** Maximum number of files to return in ls/glob (default: unlimited) */
  maxListFiles?: number;
  /** Maximum number of grep matches per file (default: 50) */
  maxGrepMatches?: number;
  /** Maximum lines to return in read (default: 500) */
  maxReadLines?: number;
  /** Maximum characters to return in read (default: 50000) */
  maxReadChars?: number;
  /** Default number of context lines for grep (default: 2) */
  defaultContextLines?: number;
  /** Default number of results for semantic search (default: 10) */
  defaultSearchResults?: number;
}

const DEFAULT_OPTIONS: Required<RepositoryToolsOptions> = {
  maxListFiles: Number.POSITIVE_INFINITY,
  maxGrepMatches: 50,
  maxReadLines: 500,
  maxReadChars: 50000,
  defaultContextLines: 2,
  defaultSearchResults: 10,
};

/**
 * Helper to create a text result response.
 */
function textResult(data: unknown): TextContent[] {
  return [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }];
}

/**
 * Helper to create an error response.
 */
function errorResult(message: string): TextContent[] {
  return textResult({ error: message });
}

/**
 * Get file info for listing.
 */
function getFileInfo(file: RepositoryFile): {
  name: string;
  status: string;
  characters: number;
  lines: number;
  extension: string;
} {
  const text = file.text || '';
  const lines = text ? splitLines(text).length : 0;
  
  return {
    name: file.name,
    status: file.status,
    characters: text.length,
    lines,
    extension: getExtension(file.name),
  };
}

/**
 * Create the ls (list files) tool.
 */
function createLsTool(
  files: RepositoryFile[],
  options: Required<RepositoryToolsOptions>
): Tool {
  return {
    name: 'repository_ls',
    description: `List files in the repository. Returns file names with metadata (status, size, line count). Use this first to discover what files are available before reading or searching them.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional path prefix to filter files. If empty, lists all files.',
        },
      },
      required: [],
    },
    function: async (args: Record<string, unknown>) => {
      const pathPrefix = (args.path as string | undefined) || '';
      
      // Filter files by path prefix
      let matchedFiles = [...files];
      
      if (pathPrefix) {
        const normalizedPrefix = pathPrefix.toLowerCase();
        matchedFiles = matchedFiles.filter(f => 
          f.name.toLowerCase().startsWith(normalizedPrefix)
        );
      }
      
      // Sort by name
      matchedFiles.sort((a, b) => a.name.localeCompare(b.name));
      
      // Check limit
      const truncated = Number.isFinite(options.maxListFiles) && matchedFiles.length > options.maxListFiles;
      const limitedFiles = truncated ? matchedFiles.slice(0, options.maxListFiles) : matchedFiles;
      
      const result = {
        files: limitedFiles.map(getFileInfo),
        total: matchedFiles.length,
        truncated,
        ...(truncated && { message: 'Results truncated. Narrow the path or configure maxListFiles for more.' }),
      };
      
      return textResult(result);
    },
  };
}

/**
 * Create the glob (pattern match files) tool.
 */
function createGlobTool(
  files: RepositoryFile[],
  options: Required<RepositoryToolsOptions>
): Tool {
  return {
    name: 'repository_glob',
    description: `Find files matching a glob pattern. Supports *, **, ?, [abc], {a,b,c} patterns.
Examples:
- "*.ts" matches TypeScript files in root
- "**/*.ts" matches all TypeScript files
- "src/**/*.{ts,tsx}" matches TS/TSX files in src
- "*.{js,jsx,ts,tsx}" matches JS/TS files`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match file names against.',
        },
      },
      required: ['pattern'],
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      
      if (!pattern) {
        return errorResult('Pattern is required');
      }
      
      // Filter files that match the pattern
      const matchedFiles = files.filter(f => matchGlob(f.name, pattern));
      
      // Sort by name
      matchedFiles.sort((a, b) => a.name.localeCompare(b.name));
      
      // Check limit
      const truncated = Number.isFinite(options.maxListFiles) && matchedFiles.length > options.maxListFiles;
      const limitedFiles = truncated ? matchedFiles.slice(0, options.maxListFiles) : matchedFiles;
      
      const result = {
        pattern,
        files: limitedFiles.map(getFileInfo),
        total: matchedFiles.length,
        truncated,
        ...(truncated && { message: 'Results truncated. Refine the pattern or configure maxListFiles for more.' }),
      };
      
      return textResult(result);
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
    description: `Search for a regex pattern across repository files. Returns matching lines with line numbers and context (context-only lines are marked with isContext=true).
Use for:
- Finding function/class/variable definitions
- Locating specific code patterns
- Searching for text across multiple files

Examples:
- "function\\s+\\w+" finds function declarations
- "TODO|FIXME" finds todo comments
- "import.*from" finds import statements`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for. Use standard JavaScript regex syntax.',
        },
        filePattern: {
          type: 'string',
          description: 'Optional glob pattern to filter which files to search (e.g., "*.ts", "src/**/*.js").',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Whether the search should be case-insensitive. Default: true.',
        },
        literal: {
          type: 'boolean',
          description: 'Treat the pattern as a literal string instead of regex. Default: false.',
        },
        contextLines: {
          type: 'number',
          description: `Number of context lines to include before and after each match. Default: ${options.defaultContextLines}.`,
        },
        maxMatches: {
          type: 'number',
          description: `Maximum number of matches to return per file. Default: ${options.maxGrepMatches}.`,
        },
      },
      required: ['pattern'],
    },
    function: async (args: Record<string, unknown>) => {
      const pattern = args.pattern as string;
      const filePattern = args.filePattern as string | undefined;
      const ignoreCase = (args.ignoreCase as boolean) ?? true;
      const literal = (args.literal as boolean) ?? false;
      const contextLines = (args.contextLines as number) ?? options.defaultContextLines;
      const maxMatches = Math.min((args.maxMatches as number) ?? options.maxGrepMatches, options.maxGrepMatches);
      
      if (!pattern) {
        return errorResult('Pattern is required');
      }
      
      // Filter to completed files
      let searchFiles = files.filter(f => f.status === 'completed' && f.text);
      
      // Apply file pattern filter
      if (filePattern) {
        searchFiles = searchFiles.filter(f => matchGlob(f.name, filePattern));
      }
      
      const results: Array<{
        fileName: string;
        matches: Array<{
          lineNumber: number;
          content: string;
          highlights: Array<{ start: number; end: number; text: string }>;
          isContext: boolean;
        }>;
        truncated: boolean;
      }> = [];
      
      let totalMatches = 0;
      const maxTotalMatches = options.maxGrepMatches * 5; // Total across all files
      let linesTruncated = false;
      
      for (const file of searchFiles) {
        if (totalMatches >= maxTotalMatches) break;
        
        const text = file.text || '';
        const { matches, truncated, matchCount } = grepText(text, pattern, {
          ignoreCase,
          literal,
          maxMatches,
          contextLines,
        });
        
        if (matches.length > 0) {
          results.push({
            fileName: file.name,
            matches: matches.map(m => ({
              lineNumber: m.lineNumber,
              content: truncateLine(m.content, 300),
              highlights: m.matches,
              isContext: m.isContext ?? false,
            })),
            truncated,
          });
          
          totalMatches += matchCount;
        }

        if (!linesTruncated && matches.some(m => truncateLine(m.content, 300).length !== m.content.length)) {
          linesTruncated = true;
        }
      }

      const notices: string[] = [];
      if (linesTruncated) {
        notices.push('Some lines were truncated. Use repository_read to view full lines.');
      }
      if (totalMatches >= maxTotalMatches) {
        notices.push('Match limit reached. Refine your pattern for more precise results.');
      }
      
      return textResult({
        pattern,
        filePattern: filePattern || null,
        results,
        totalMatches,
        filesSearched: searchFiles.length,
        truncated: totalMatches >= maxTotalMatches,
        ...(notices.length > 0 && { message: notices.join(' ') }),
      });
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
    description: `Read the content of a file from the repository. Returns the file content with line numbers.
Use after discovering files with repository_ls or repository_glob.
Supports reading specific line ranges for large files.`,
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
        return textResult({
          fileName: file.name,
          content: '',
          totalLines: 0,
          message: 'File has no text content.',
        });
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
      
      const result = {
        fileName: file.name,
        startLine: safeStartLine,
        endLine: actualEndLine,
        totalLines,
        content: formattedContent,
        truncated: hasMore || charTruncated,
        ...(hasMore && { nextStartLine: actualEndLine + 1 }),
        ...(charTruncated && { message: 'Content truncated due to size limit.' }),
        ...(hasMore && !charTruncated && { message: 'Content truncated by line limit. Use startLine/endLine to read the next segment.' }),
      };
      
      return textResult(result);
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
    description: `Semantic search across repository files using natural language. Returns relevant text chunks ranked by similarity.
Use for:
- Finding code related to a concept or feature
- Discovering relevant documentation
- Locating implementations when you don't know exact names
- Broad exploration of unfamiliar codebases

This uses embeddings for meaning-based search, not exact text matching. For exact pattern matching, use repository_grep instead.`,
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
          return textResult({
            query,
            results: [],
            message: 'No relevant results found.',
          });
        }
        
        const formattedResults = results.map((result, index) => ({
          rank: index + 1,
          fileName: result.file.name,
          similarity: result.similarity !== undefined ? Math.round(result.similarity * 100) / 100 : null,
          content: truncateLine(result.text, 1000),
        }));
        
        return textResult({
          query,
          results: formattedResults,
          totalResults: results.length,
        });
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
    createLsTool(files, opts),
    createGlobTool(files, opts),
    createGrepTool(files, opts),
    createReadTool(files, opts),
    createSearchTool(queryChunks, opts),
  ];
}

/**
 * Get the instructions for repository tools.
 */
// Tool instructions are provided via prompts/repository.txt
