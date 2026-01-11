/**
 * HTML transformation utilities for artifact preview
 * 
 * Transforms HTML content to use data URLs for virtual file references,
 * enabling iframes to access files from the artifact filesystem.
 */
import { lookupContentType, getFileExt } from './utils';
import type { FileSystem } from '../types/file';

// Import the VFS runtime script as raw text
import vfsRuntimeScript from './vfs-runtime.js?raw';

// Result type for HTML transformation
export interface TransformResult {
  html: string;
  cleanup: () => void;
}

/**
 * Normalize a file path by removing leading ./ and /
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Check if content is a data URL (base64 encoded)
 */
function isDataUrl(content: string): boolean {
  return content.startsWith('data:');
}

/**
 * Convert file content to a data URL
 * If already a data URL, returns as-is
 * Otherwise encodes as base64 with the appropriate MIME type
 */
function contentToDataUrl(content: string, contentType?: string): string {
  if (isDataUrl(content)) {
    return content;
  }
  // Plain text content - encode as base64 data URL
  const mimeType = contentType || 'text/plain';
  const base64 = btoa(unescape(encodeURIComponent(content)));
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Generate data URLs for all files in the filesystem
 * Returns a Map of normalized path -> data URL
 * Data URLs work better than blob URLs in sandboxed iframes (especially Safari)
 */
function generateDataUrls(files: FileSystem): Map<string, string> {
  const urls = new Map<string, string>();

  for (const [path, file] of Object.entries(files)) {
    const normalized = normalizePath(path);
    
    // Determine content type from file extension if not provided
    const ext = getFileExt(path);
    const contentType = file.contentType || (ext ? lookupContentType(ext) : undefined);
    
    const dataUrl = contentToDataUrl(file.content, contentType);
    
    // Store under normalized path (without leading /)
    urls.set(normalized, dataUrl);
    // Also store under original path in case it's referenced that way
    if (path !== normalized) {
      urls.set(path, dataUrl);
    }
  }

  return urls;
}

/**
 * Get raw file content (decode if data URL, otherwise return as-is)
 */
function getFileContent(file: { content: string }): string {
  if (isDataUrl(file.content)) {
    // Decode base64 data URL to get raw content
    const [header, base64] = file.content.split(',');
    // Check if it's base64 encoded
    if (header.includes('base64')) {
      try {
        return decodeURIComponent(escape(atob(base64)));
      } catch {
        // Binary content, return as-is
        return file.content;
      }
    }
    return decodeURIComponent(base64);
  }
  return file.content;
}

/**
 * Transform CSS content by replacing url() references with data URLs
 */
function transformCssUrls(css: string, urls: Map<string, string>): string {
  return css.replace(/url\(["']?([^"')]+)["']?\)/g, (match, path) => {
    // Skip data URLs and absolute URLs
    if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://')) {
      return match;
    }
    const normalized = normalizePath(path);
    const dataUrl = urls.get(normalized);
    return dataUrl ? `url("${dataUrl}")` : match;
  });
}

/**
 * Transform HTML content to use data URLs for artifact references
 * CSS files are inlined as <style> tags for better Safari compatibility
 * Also injects a vfs helper object for dynamic JavaScript access
 */
export function transformHtmlForPreview(html: string, files: FileSystem): TransformResult {
  // If no files, return original HTML with no-op cleanup
  if (!files || Object.keys(files).length === 0) {
    return { html, cleanup: () => {} };
  }

  // Generate data URLs for all files (no cleanup needed for data URLs)
  const urls = generateDataUrls(files);
  
  // Build URL mapping object for injection
  const urlMapping: Record<string, string> = {};
  urls.forEach((url: string, path: string) => {
    urlMapping[path] = url;
  });

  let transformed = html;

  // Inline CSS files from <link> tags with rel="stylesheet"
  // Use a flexible regex that matches any <link> tag (including self-closing)
  transformed = transformed.replace(
    /<link\s+([^>]*?)\s*\/?>/gi,
    (match, attributes) => {
      // Check if this is a stylesheet link
      if (!/rel\s*=\s*["']?stylesheet["']?/i.test(attributes)) {
        return match;
      }
      
      // Extract href value (handles both quoted and unquoted)
      const hrefMatch = attributes.match(/href\s*=\s*["']?([^"'\s>]+)["']?/i);
      if (!hrefMatch) {
        return match;
      }
      
      const href = hrefMatch[1];
      
      // Skip absolute URLs
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
        return match;
      }
      
      const normalized = normalizePath(href);
      // Also try with leading slash since artifacts may be stored that way
      const withSlash = '/' + normalized;
      const file = files[normalized] || files[href] || files[withSlash];
      
      if (file) {
        // Get raw CSS content and transform url() references within it
        const cssContent = getFileContent(file);
        const transformedCss = transformCssUrls(cssContent, urls);
        return `<style>/* Inlined from ${href} */\n${transformedCss}</style>`;
      }
      return match;
    }
  );

  // Transform static src attributes (img, script, video, audio, source, etc.)
  transformed = transformed.replace(
    /(<(?:img|script|video|audio|source|embed|track)[^>]+)src=["']([^"']+)["']/gi,
    (match, prefix, path) => {
      // Skip data URLs and absolute URLs
      if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
        return match;
      }
      const normalized = normalizePath(path);
      const dataUrl = urls.get(normalized);
      return dataUrl ? `${prefix}src="${dataUrl}"` : match;
    }
  );

  // Transform href attributes for <a> tags (not <link> - those are handled above)
  transformed = transformed.replace(
    /(<a[^>]+)href=["']([^"']+)["']/gi,
    (match, prefix, path) => {
      // Skip anchors, data URLs, absolute URLs, and special links
      if (path.startsWith('#') || path.startsWith('data:') || 
          path.startsWith('http://') || path.startsWith('https://') ||
          path.startsWith('mailto:') || path.startsWith('tel:') ||
          path.startsWith('blob:')) {
        return match;
      }
      const normalized = normalizePath(path);
      const dataUrl = urls.get(normalized);
      return dataUrl ? `${prefix}href="${dataUrl}"` : match;
    }
  );

  // Transform inline style url() references
  transformed = transformed.replace(
    /style=["']([^"']*)["']/gi,
    (_match, styleContent) => {
      const transformedStyle = transformCssUrls(styleContent, urls);
      return `style="${transformedStyle}"`;
    }
  );

  // Transform <style> block contents
  transformed = transformed.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, openTag, cssContent, closeTag) => {
      const transformedCss = transformCssUrls(cssContent, urls);
      return `${openTag}${transformedCss}${closeTag}`;
    }
  );

  // Build the VFS script with URL mapping injected
  const vfsScript = `
<script>
window.__VFS_URLS__ = ${JSON.stringify(urlMapping)};
${vfsRuntimeScript}
</script>
`;

  // Inject script after <head> or at start of document
  if (transformed.includes('<head>')) {
    transformed = transformed.replace('<head>', '<head>' + vfsScript);
  } else if (transformed.includes('<head ')) {
    transformed = transformed.replace(/<head\s[^>]*>/, (match) => match + vfsScript);
  } else if (transformed.includes('<body>')) {
    transformed = transformed.replace('<body>', '<body>' + vfsScript);
  } else if (transformed.includes('<body ')) {
    transformed = transformed.replace(/<body\s[^>]*>/, (match) => match + vfsScript);
  } else if (transformed.includes('<html>') || transformed.includes('<html ')) {
    // Insert after <html> tag
    transformed = transformed.replace(/<html[^>]*>/, (match) => match + vfsScript);
  } else {
    // No recognizable structure, prepend
    transformed = vfsScript + transformed;
  }

  // No cleanup needed for data URLs (they don't need to be revoked like blob URLs)
  return { html: transformed, cleanup: () => {} };
}
