import { memo, useState, useEffect } from 'react';
import { useShiki } from '../hooks/useShiki';
import { CopyButton } from './CopyButton';

interface CodeRendererProps {
  code: string;
  language: string;
}

const CodeRenderer = memo(({ code, language }: CodeRendererProps) => {
  const { codeToHtml } = useShiki();
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    if (!code) {
      setHtml('');
      return;
    }

    let isCancelled = false;

    const highlightCode = async () => {
      try {
        const langId = language.toLowerCase();
        
        if (isCancelled) return;

        const html = await codeToHtml(code, langId);
        
        if (!isCancelled) {
          setHtml(html);
        }
      } catch (error) {
        console.error('Failed to highlight code:', error);
        if (!isCancelled) {
          setHtml('');
        }
      }
    };

    highlightCode();

    return () => {
      isCancelled = true;
    };
  }, [code, language, codeToHtml]);

  const renderCodeBlock = (content: React.ReactNode) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{language}</span>
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