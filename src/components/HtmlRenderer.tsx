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
        setIframeHeight(Math.max(e.data.height, 50)); // Minimum height of 50px
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

  // Show loading state until HTML is complete
  if (!isComplete) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || language}</span>
        </div>
        <div className="bg-white dark:bg-neutral-900 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500"></div>
              <span>Generating Content...</span>
            </div>
          </div>
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
      window.addEventListener('load', sendHeight);
      new ResizeObserver(sendHeight).observe(document.documentElement);
    </script>`;

    // Check if it's already a complete HTML document
    const isCompleteDocument = html.includes('<!DOCTYPE') || (html.includes('<html') && html.includes('</html>'));
    
    if (isCompleteDocument) {
      // Just append the script before closing </body> or </html>
      return html.replace('</body>', `${script}</body>`) || html.replace('</html>', `${script}</html>`);
    } else {
      // Wrap fragment in minimal HTML structure
      return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>html,body{margin:0;padding:0;}</style>
        </head><body>${html}${script}</body></html>`;
    }
  })();

  return (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{extractedTitle || language}</span>
        <div className="flex items-center gap-2">
          {isComplete && (
            <Button
              onClick={() => setShowCode(!showCode)}
              className="text-neutral-300 hover:text-white transition-colors"
              title={showCode ? 'Show preview' : 'Show code'}
            >
              {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
            </Button>
          )}
          <CopyButton text={html} />
        </div>
      </div>
      
      <div className="bg-white dark:bg-neutral-900 rounded-b-md">
        {isComplete && !showCode ? (
          <iframe
            key={html.length} // Force re-render when HTML changes
            ref={iframeRef}
            srcDoc={wrappedSrcDoc}
            sandbox="allow-scripts allow-same-origin"
            title="HTML Preview"
            className="w-full rounded-b-md"
            style={{ height: `${iframeHeight}px` }}
          />
        ) : (
          <div className="p-4">
            <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
              <code>{html}</code>
            </pre>
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
