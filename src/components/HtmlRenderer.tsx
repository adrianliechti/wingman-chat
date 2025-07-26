import { memo, useState, useEffect, useRef } from 'react';
import { Eye, Code } from 'lucide-react';
import { Button } from '@headlessui/react';
import { CopyButton } from './CopyButton';

interface HtmlRendererProps {
  html: string;
  language: string;
}

// Utility function to extract title from HTML content
const extractTitle = (html: string): string | null => {
  // Extract from <title> tag only
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    return titleMatch[1].trim();
  }

  return null;
};

const NonMemoizedHtmlRenderer = ({ html, language }: HtmlRendererProps) => {
  const [showCode, setShowCode] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(50);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isComplete = html.trim().length > 0 && html.includes('</html>');
  const extractedTitle = extractTitle(html);

  // Listen for height messages from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'html-renderer-resize' && iframeRef.current && e.source === iframeRef.current.contentWindow) {
        // Calculate max height based on aspect ratio (4:3) and actual iframe width
        const iframeWidth = iframeRef.current.offsetWidth;
        const maxHeightFromAspectRatio = iframeWidth * (3 / 4); // 4:3 aspect ratio means height = width * 3/4
        const constrainedHeight = Math.min(e.data.height, maxHeightFromAspectRatio);
        setIframeHeight(Math.max(constrainedHeight, 50)); // Minimum height of 50px
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Reset height when HTML content changes to allow proper shrinking
  useEffect(() => {
    if (isComplete && !showCode) {
      setIframeHeight(50); // Reset to minimum height, will grow as needed
    }
  }, [html, isComplete, showCode]);

  // Listen for theme changes and notify iframe
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'theme-change', isDark }, '*');
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Notify iframe of initial theme state when it loads
  useEffect(() => {
    const handleIframeLoad = () => {
      const isDark = document.documentElement.classList.contains('dark');
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'theme-change', isDark }, '*');
      }
    };

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', handleIframeLoad);
      return () => iframe.removeEventListener('load', handleIframeLoad);
    }
  }, [html]); // Re-run when HTML changes to handle new iframe instances

  // Show loading state until HTML is complete
  if (!isComplete) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || language}</span>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowCode(!showCode)}
              className="text-neutral-300 hover:text-white transition-colors"
              title={showCode ? 'Show preview' : 'Show code'}
            >
              {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
            </Button>
            <CopyButton text={html} />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{html}</code>
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
                <span>Generating Content...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const wrappedSrcDoc = (() => {
    const script = `<script>
      function sendHeight() {
        const height = document.documentElement.scrollHeight;
        parent.postMessage({type:'html-renderer-resize', height}, '*');
      }
      
      function applyDarkMode() {
        // Check if parent window has dark mode
        const isDark = parent.document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', isDark);
      }
      
      window.addEventListener('load', () => {
        sendHeight();
        applyDarkMode();
      });
      
      new ResizeObserver(sendHeight).observe(document.documentElement);
      
      // Listen for theme changes from parent
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'theme-change') {
          applyDarkMode();
        }
      });
    </script>`;

    const defaultStyles = `<style>
      html, body {
        margin: 0;
        padding: 0;
        font-family: ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
        line-height: 1.6;
      }
      
      body {
        padding: 1rem;
      }
      
      /* Default light mode styles */
      body {
        color: #374151;
        background-color: #ffffff;
      }
      
      /* Dark mode styles */
      .dark body {
        color: #d1d5db;
        background-color: #171717;
      }
      
      /* Only apply defaults if no explicit colors are set */
      body:not([style*="color"]):not([class*="text-"]) {
        color: #374151;
      }
      
      .dark body:not([style*="color"]):not([class*="text-"]) {
        color: #d1d5db;
      }
      
      body:not([style*="background"]):not([class*="bg-"]) {
        background-color: #ffffff;
      }
      
      .dark body:not([style*="background"]):not([class*="bg-"]) {
        background-color: #171717;
      }
      
      /* Default styling for common elements */
      h1, h2, h3, h4, h5, h6 {
        color: inherit;
      }
      
      p, div, span {
        color: inherit;
      }
      
      /* Links */
      a {
        color: #3b82f6;
      }
      
      .dark a {
        color: #60a5fa;
      }
    </style>`;

    // Check if it's already a complete HTML document
    const isCompleteDocument = html.includes('<html') && html.includes('</html>');

    if (isCompleteDocument) {
      // Insert styles and script into existing document
      let modifiedHtml = html;

      // Try to insert styles in head, fallback to before closing head or html
      if (html.includes('</head>')) {
        modifiedHtml = modifiedHtml.replace('</head>', `${defaultStyles}</head>`);
      } else if (html.includes('<head>')) {
        modifiedHtml = modifiedHtml.replace('<head>', `<head>${defaultStyles}`);
      } else {
        modifiedHtml = modifiedHtml.replace('<html>', `<html><head>${defaultStyles}</head>`);
      }

      // Insert script before closing body or html
      if (html.includes('</body>')) {
        modifiedHtml = modifiedHtml.replace('</body>', `${script}</body>`);
      } else {
        modifiedHtml = modifiedHtml.replace('</html>', `${script}</html>`);
      }

      return modifiedHtml;
    } else {
      // Wrap fragment in minimal HTML structure
      return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${defaultStyles}</head><body>${html}${script}</body></html>`;
    }
  })();

  return (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{extractedTitle || language}</span>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowCode(!showCode)}
            className="text-neutral-300 hover:text-white transition-colors"
            title={showCode ? 'Show preview' : 'Show code'}
          >
            {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
          </Button>
          <CopyButton text={html} />
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {showCode ? (
          <div className="p-4">
            <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
              <code>{html}</code>
            </pre>
          </div>
        ) : isComplete ? (
          <iframe
            key={html.length} // Force re-render when HTML changes
            ref={iframeRef}
            srcDoc={wrappedSrcDoc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full rounded-b-md max-h-[75vw] aspect-[4/3]"
            style={{ height: `${iframeHeight}px` }}
          />
        ) : (
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
              <span>Generating Content...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const HtmlRenderer = memo(
  NonMemoizedHtmlRenderer,
  (prevProps, nextProps) =>
    prevProps.html === nextProps.html && prevProps.language === nextProps.language
);
