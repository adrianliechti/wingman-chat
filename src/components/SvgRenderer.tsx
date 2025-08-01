import { memo, useState } from 'react';
import { CopyButton } from './CopyButton';
import { PreviewButton } from './PreviewButton';

interface SvgRendererProps {
  svg: string;
  language: string;
}

const extractTitle = (svg: string): string | null => {
  const match = svg.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match && match[1].trim() ? match[1].trim() : null;
};

const NonMemoizedSvgRenderer = ({ svg, language }: SvgRendererProps) => {
  const [showCode, setShowCode] = useState(false);
  const isComplete = svg.trim().length > 0 && /<\/svg>/i.test(svg);
  const extractedTitle = extractTitle(svg);

  if (!isComplete) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{extractedTitle || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton showCode={showCode} onToggle={() => setShowCode(!showCode)} className="h-4 w-4" />
            <CopyButton text={svg} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{svg}</code>
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400" />
                <span>Generating SVG...</span>
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
        <span>{extractedTitle || language}</span>
        <div className="flex items-center gap-2">
          <PreviewButton showCode={showCode} onToggle={() => setShowCode(!showCode)} className="h-4 w-4" />
          <CopyButton text={svg} className="h-4 w-4" />
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {showCode ? (
          <div className="p-4">
            <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
              <code>{svg}</code>
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center p-4 overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} style={{ maxHeight: '75vw' }} />
        )}
      </div>
    </div>
  );
};

export const SvgRenderer = memo(
  NonMemoizedSvgRenderer,
  (prevProps, nextProps) => prevProps.svg === nextProps.svg && prevProps.language === nextProps.language,
);
