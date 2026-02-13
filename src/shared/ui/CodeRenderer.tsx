import { memo, useState, useEffect, useRef } from 'react';
import { codeToHtml } from 'shiki';
import { CopyButton } from './CopyButton';
import { useTheme } from '@/shell/hooks/useTheme';

const HIGHLIGHT_DEBOUNCE_MS = 150;

interface CodeRendererProps {
  code: string;
  language: string;
  name?: string;
}

const CodeRenderer = memo(({ code, language, name }: CodeRendererProps) => {
  const { isDark } = useTheme();
  const [html, setHtml] = useState<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Clear any pending debounced highlight
    clearTimeout(debounceRef.current);

    if (!code) {
      setHtml('');
      return;
    }

    // Debounce Shiki calls — during streaming, code changes on every token
    debounceRef.current = setTimeout(() => {
      let isCancelled = false;

      const highlightCode = async () => {
        try {
          const langId = language.toLowerCase();
          const highlighted = await codeToHtml(code, {
            lang: langId,
            theme: isDark ? 'one-dark-pro' : 'one-light',
            colorReplacements: {
              '#fafafa': 'transparent',
              '#282c34': 'transparent',
            }
          });
          if (!isCancelled) {
            setHtml(highlighted);
          }
        } catch (error) {
          console.error('Failed to highlight code:', error);
          if (!isCancelled) {
            setHtml('');
          }
        }
      };

      highlightCode();

      // Cleanup for this specific timeout's async call
      return () => { isCancelled = true; };
    }, HIGHLIGHT_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceRef.current);
    };
  }, [code, language, isDark]);

  const renderCodeBlock = (content: React.ReactNode) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>
          {language}
          {name && <span className="ml-2 text-gray-500 dark:text-neutral-400">• {name}</span>}
        </span>
        <div className="flex items-center space-x-2">
          <CopyButton text={code} className="h-4 w-4" />
        </div>
      </div>
      <div className="bg-white dark:bg-neutral-900 rounded-b-md overflow-hidden border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {content}
      </div>
    </div>
  );

  if (!html) {
    return renderCodeBlock(
      <pre className="p-4 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre overflow-x-auto">
        <code>{code}</code>
      </pre>
    );
  }

  return renderCodeBlock(
    <div 
      className="overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        margin: 0,
        padding: '1rem',
        fontSize: '0.875rem',
        lineHeight: '1.25rem',
        fontFamily: 'Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace',
        background: 'transparent'
      }}
    />
  );
});

CodeRenderer.displayName = 'CodeRenderer';

export { CodeRenderer };