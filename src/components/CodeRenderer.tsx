import { memo, useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { CopyButton } from './CopyButton';

interface CodeRendererProps {
  code: string;
  language: string;
}

const CodeRenderer = memo(({ code, language }: CodeRendererProps) => {
  const { isDark } = useTheme();
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const highlightCode = async () => {
      try {
        const { createHighlighter } = await import('shiki');
        
        const highlighter = await createHighlighter({
          themes: ['one-dark-pro', 'one-light'],
          langs: [] // Start with no languages, load them dynamically
        });

        if (isCancelled) return;

        // Try to load the language dynamically
        const langId = language.toLowerCase();
        
        try {
          // Check if the language is supported before loading
          const { bundledLanguages } = await import('shiki');
          if (bundledLanguages[langId as keyof typeof bundledLanguages]) {
            await highlighter.loadLanguage(langId as keyof typeof bundledLanguages);
          }
        } catch {
          console.warn(`Language '${language}' not found, falling back to plain text`);
        }

        const theme = isDark ? 'one-dark-pro' : 'one-light';
        
        const html = highlighter.codeToHtml(code, {
          lang: langId,
          theme,
          colorReplacements: {
            '#fafafa': 'transparent', // one-light background
            '#282c34': 'transparent', // one-dark-pro background
          }
        });
        
        setHighlightedCode(html);
      } catch (error) {
        console.error('Failed to highlight code:', error);
        setHighlightedCode('');
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    highlightCode();

    return () => {
      isCancelled = true;
    };
  }, [code, language, isDark]);

  const renderCodeBlock = (content: React.ReactNode, showSpinner = false) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{language}</span>
        <div className="flex items-center space-x-2">
          {showSpinner && (
            <div className="animate-spin rounded-full h-3 w-3 border border-blue-500 border-t-transparent" />
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <div className="bg-white dark:bg-neutral-900 rounded-b-md overflow-hidden border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {content}
      </div>
    </div>
  );

  if (isLoading) {
    return renderCodeBlock(
      <pre className="p-4 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
        <code>{code}</code>
      </pre>,
      true
    );
  }

  if (!highlightedCode) {
    return renderCodeBlock(
      <pre className="p-4 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
        <code>{code}</code>
      </pre>
    );
  }

  return renderCodeBlock(
    <div 
      dangerouslySetInnerHTML={{ __html: highlightedCode }}
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
