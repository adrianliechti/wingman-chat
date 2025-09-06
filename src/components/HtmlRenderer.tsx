import { memo, useState } from 'react';
import { CopyButton } from './CopyButton';
import { PreviewButton } from './PreviewButton';

interface HtmlRendererProps {
  html: string;
  language: string;
  name?: string;
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

const NonMemoizedHtmlRenderer = ({ html, language, name }: HtmlRendererProps) => {
  const [showCode, setShowCode] = useState(false);

  const extractedTitle = extractTitle(html);

  // Show loading state if HTML is empty
  if (!html.trim()) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || name || language}</span>
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

  return (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{extractedTitle || name || language}</span>
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
          <iframe
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full rounded-b-md"
            style={{ height: '400px' }}
          />
        )}
      </div>
    </div>
  );
};

export const HtmlRenderer = memo(
  NonMemoizedHtmlRenderer,
  (prevProps, nextProps) =>
    prevProps.html === nextProps.html && prevProps.language === nextProps.language && prevProps.name === nextProps.name
);
