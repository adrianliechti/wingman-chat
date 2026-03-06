/**
 * Text utilities for repository file operations.
 * Handles cross-platform line endings and text manipulation.
 */

/**
 * Split text into lines, handling both Windows (\r\n) and Unix (\n) line endings.
 * Preserves empty lines and handles mixed line endings correctly.
 */
export function splitLines(text: string): string[] {
  // Normalize line endings to \n then split
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Get a range of lines from an array (1-indexed, inclusive).
 * Returns empty array if range is invalid.
 * 
 * @param lines - Array of lines
 * @param startLine - Start line (1-indexed, inclusive)
 * @param endLine - End line (1-indexed, inclusive). If undefined, returns from startLine to end.
 * @returns Array of lines in the specified range
 */
export function getLineRange(
  lines: string[],
  startLine: number,
  endLine?: number
): string[] {
  const total = lines.length;
  
  // Clamp start to valid range
  const start = Math.max(1, Math.min(startLine, total));
  
  // Clamp end to valid range (default to end of file)
  const end = endLine !== undefined 
    ? Math.max(start, Math.min(endLine, total))
    : total;
  
  // Convert to 0-indexed and slice (start is inclusive, end is exclusive in slice)
  return lines.slice(start - 1, end);
}

/**
 * Format lines with line numbers for display.
 * 
 * @param lines - Array of lines
 * @param startLine - The line number of the first line (1-indexed)
 * @returns Formatted string with line numbers
 */
export function formatLineOutput(lines: string[], startLine: number = 1): string {
  const endLine = startLine + lines.length - 1;
  const maxLineNumWidth = String(endLine).length;
  
  return lines
    .map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(maxLineNumWidth, ' ');
      return `${lineNum}: ${line}`;
    })
    .join('\n');
}

/**
 * Match a filename against a glob pattern.
 * Supports:
 * - * matches any characters except /
 * - ** matches any characters including /
 * - ? matches a single character except /
 * - Character classes [abc], [a-z], [!abc]
 * 
 * @param filename - The filename to test
 * @param pattern - The glob pattern
 * @returns true if the filename matches the pattern
 */
export function matchGlob(filename: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedFilename = filename.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  
  // Convert glob pattern to regex
  const regexPattern = globToRegex(normalizedPattern);
  
  try {
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(normalizedFilename);
  } catch {
    // Invalid regex, fall back to simple includes check
    return normalizedFilename.toLowerCase().includes(normalizedPattern.toLowerCase());
  }
}

/**
 * Convert a glob pattern to a regex pattern string.
 */
function globToRegex(glob: string): string {
  let regex = '';
  let i = 0;
  
  while (i < glob.length) {
    const c = glob[i];
    
    if (c === '*') {
      // Check for **
      if (glob[i + 1] === '*') {
        // ** matches everything including /
        regex += '.*';
        i += 2;
        // Skip trailing / after **
        if (glob[i] === '/') {
          regex += '(?:/|$)';
          i++;
        }
      } else {
        // * matches everything except /
        regex += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      // ? matches single character except /
      regex += '[^/]';
      i++;
    } else if (c === '[') {
      // Character class
      const classEnd = glob.indexOf(']', i + 1);
      if (classEnd === -1) {
        // No closing bracket, treat as literal
        regex += escapeRegex(c);
        i++;
      } else {
        let classContent = glob.slice(i + 1, classEnd);
        // Handle negation
        if (classContent[0] === '!') {
          classContent = '^' + classContent.slice(1);
        }
        regex += `[${classContent}]`;
        i = classEnd + 1;
      }
    } else if (c === '{') {
      // Brace expansion {a,b,c}
      const braceEnd = glob.indexOf('}', i + 1);
      if (braceEnd === -1) {
        regex += escapeRegex(c);
        i++;
      } else {
        const options = glob.slice(i + 1, braceEnd).split(',');
        regex += `(?:${options.map(escapeRegex).join('|')})`;
        i = braceEnd + 1;
      }
    } else {
      // Escape special regex characters
      regex += escapeRegex(c);
      i++;
    }
  }
  
  return regex;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Line match result from grep operation.
 */
export interface LineMatch {
  lineNumber: number;
  content: string;
  matches: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  /** True when this line is included only as surrounding context. */
  isContext?: boolean;
}

/**
 * File match result from grep operation.
 */
export interface FileMatch {
  fileName: string;
  matches: LineMatch[];
  truncated: boolean;
}

/**
 * Search for a pattern in text content using regex.
 * 
 * @param text - The text content to search
 * @param pattern - Regex pattern to search for
 * @param options - Search options
 * @returns Array of line matches
 */
export function grepText(
  text: string,
  pattern: string,
  options: {
    caseSensitive?: boolean;
    ignoreCase?: boolean;
    literal?: boolean;
    maxMatches?: number;
    contextLines?: number;
  } = {}
): { matches: LineMatch[]; truncated: boolean; matchCount: number } {
  const {
    caseSensitive = false,
    ignoreCase,
    literal = false,
    maxMatches = 50,
    contextLines = 0,
  } = options;
  
  const lines = splitLines(text);
  const matchesByLine = new Map<number, LineMatch>();
  const contextLineNumbers = new Set<number>();
  let matchCount = 0;
  let truncated = false;
  
  // Create regex
  let regex: RegExp;
  try {
    const effectiveCaseSensitive = ignoreCase === true ? false : caseSensitive;
    const flags = effectiveCaseSensitive ? 'g' : 'gi';
    if (literal) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, flags);
    } else {
      regex = new RegExp(pattern, flags);
    }
  } catch {
    // Invalid regex, treat as literal
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const effectiveCaseSensitive = ignoreCase === true ? false : caseSensitive;
    const flags = effectiveCaseSensitive ? 'g' : 'gi';
    regex = new RegExp(escaped, flags);
  }
  
  // Search each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineMatches: LineMatch['matches'] = [];
    
    // Reset regex state for global flag
    regex.lastIndex = 0;
    
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      lineMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      
      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
    
    if (lineMatches.length > 0) {
      matchCount += 1;

      matchesByLine.set(i, {
        lineNumber: i + 1, // 1-indexed
        content: line,
        matches: lineMatches,
      });

      // Add context lines (including the matched line)
      for (let c = Math.max(0, i - contextLines); c <= Math.min(lines.length - 1, i + contextLines); c++) {
        contextLineNumbers.add(c);
      }

      // Check limit (match lines only)
      if (matchCount >= maxMatches) {
        truncated = true;
        break;
      }
    }
  }

  if (matchCount === 0) {
    return { matches: [], truncated: false, matchCount: 0 };
  }

  const orderedLineNumbers = Array.from(contextLineNumbers).sort((a, b) => a - b);
  const matches: LineMatch[] = orderedLineNumbers.map(lineIndex => {
    const match = matchesByLine.get(lineIndex);
    if (match) {
      return match;
    }

    return {
      lineNumber: lineIndex + 1,
      content: lines[lineIndex] ?? '',
      matches: [],
      isContext: true,
    };
  });
  
  return { matches, truncated, matchCount };
}

/**
 * Truncate long lines for display.
 * 
 * @param line - The line to truncate
 * @param maxLength - Maximum length (default 500)
 * @returns Truncated line with indicator if truncated
 */
export function truncateLine(line: string, maxLength: number = 500): string {
  if (line.length <= maxLength) {
    return line;
  }
  return line.slice(0, maxLength) + '... (truncated)';
}

/**
 * Get file extension from filename.
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Get the base name (filename without path) from a file path.
 */
export function getBaseName(filepath: string): string {
  const normalized = filepath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}
