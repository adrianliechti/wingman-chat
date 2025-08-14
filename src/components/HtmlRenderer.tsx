import { memo, useState, useEffect, useRef } from 'react';
import { CopyButton } from './CopyButton';
import { PreviewButton } from './PreviewButton';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxAspectHeight, setMaxAspectHeight] = useState<number | null>(null);

  // 4:3 width:height ratio cap -> height cannot exceed width * 3/4
  const ASPECT_RATIO_WIDTH = 4;
  const ASPECT_RATIO_HEIGHT = 3;
  const computeMaxHeight = (w: number) => (w * ASPECT_RATIO_HEIGHT) / ASPECT_RATIO_WIDTH;

  // Observe container width to derive max allowed height
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          setMaxAspectHeight(computeMaxHeight(w));
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const isComplete = html.trim().length > 0 && html.includes('</html>');
  const extractedTitle = extractTitle(html);

  // Listen for height messages from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'html-renderer-resize' && iframeRef.current && e.source === iframeRef.current.contentWindow) {
        const rawHeight = Math.max(Number(e.data.height) || 0, 30);
        const capped = maxAspectHeight ? Math.min(rawHeight, maxAspectHeight) : rawHeight;
        setIframeHeight(capped);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [maxAspectHeight]);

  // Clamp current height if container shrinks
  useEffect(() => {
    if (maxAspectHeight && iframeHeight > maxAspectHeight) {
      setIframeHeight(maxAspectHeight);
    }
  }, [maxAspectHeight, iframeHeight]);

  // Reset + request re-measure when HTML content changes or when switching back from code view
  useEffect(() => {
    if (isComplete && !showCode) {
      setIframeHeight(50);
      setTimeout(() => {
        try { iframeRef.current?.contentWindow?.postMessage('measure', '*'); } catch { /* ignore */ }
      }, 40);
    }
  }, [html, isComplete, showCode]);

  // Show loading state until HTML is complete
  if (!isComplete) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={html} className="h-4 w-4" />
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
      (function() {
        let last = 0;
        function measure() {
          const h = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
            document.documentElement.offsetHeight,
            document.body.offsetHeight
          );
          if (Math.abs(h - last) > 2) {
            last = h;
            parent.postMessage({ type: 'html-renderer-resize', height: h }, '*');
          }
        }
        window.addEventListener('load', () => {
          measure();
          setTimeout(measure, 60);
          setTimeout(measure, 200);
          setTimeout(measure, 600);
        });
        window.addEventListener('message', e => { if (e.data === 'measure') measure(); });
        new ResizeObserver(measure).observe(document.documentElement);
        new MutationObserver(measure).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
      })();
    </script>`;

    const defaultStyles = `<style>
      html, body { margin:0; padding:0; }
      body { box-sizing:border-box; overflow:auto; }
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
  <div ref={containerRef} className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{extractedTitle || language}</span>
        <div className="flex items-center gap-2">
          <PreviewButton 
            showCode={showCode} 
            onToggle={() => setShowCode(!showCode)} 
            className="h-4 w-4" 
          />
          <CopyButton text={html} className="h-4 w-4" />
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
            className="w-full rounded-b-md"
            style={{
              height: `${iframeHeight}px`,
              maxHeight: maxAspectHeight ? `${maxAspectHeight}px` : undefined,
              minHeight: '50px',
              overflow: 'hidden'
            }}
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
