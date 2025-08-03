import { useState, useEffect } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from '../hooks/useTheme';

interface CodeEditorProps {
  blob: Blob;
  language?: string;
}

export function CodeEditor({ blob, language = '' }: CodeEditorProps) {
  const [content, setContent] = useState<string>('');
  const [html, setHtml] = useState<string>('');
  const { isDark } = useTheme();
  
  // Read blob content
  useEffect(() => {
    const readBlob = async () => {
      try {
        const text = await blob.text();
        setContent(text);
      } catch {
        setContent('Error reading file content');
      }
    };
    
    readBlob();
  }, [blob]);
  
  // Highlight code when content changes
  useEffect(() => {
    if (!content) return;
    
    const highlight = async () => {
      try {
        const langId = language.toLowerCase();
        
        const highlighted = await codeToHtml(content, {
          lang: langId || 'text',
          theme: isDark ? 'one-dark-pro' : 'one-light',
          colorReplacements: {
            '#fafafa': 'transparent', // one-light background
            '#282c34': 'transparent', // one-dark-pro background
          }
        });
        
        setHtml(highlighted);
      } catch (error) {
        console.error('Highlighting failed:', error);
        // Fallback to plain text
        setHtml(`<pre><code>${content}</code></pre>`);
      }
    };
    
    highlight();
  }, [content, language, isDark]);
  
  return (
    <div className="h-full relative">
      {html && html.trim() ? (
        <div 
          className="h-full overflow-auto"
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
      ) : (
        <pre className="text-sm text-gray-800 dark:text-neutral-300 whitespace-pre font-mono h-full overflow-auto p-4">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}