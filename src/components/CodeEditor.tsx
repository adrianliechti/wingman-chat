import { useState, useEffect } from 'react';
import { useShiki } from '../hooks/useShiki';

interface CodeEditorProps {
  blob: Blob;
  language?: string;
}

export function CodeEditor({ blob, language = '' }: CodeEditorProps) {
  const [content, setContent] = useState<string>('');
  const [html, setHtml] = useState<string>('');
  const { codeToHtml } = useShiki();
  
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
        const highlighted = await codeToHtml(content, language);
        setHtml(highlighted);
      } catch (error) {
        console.error('Highlighting failed:', error);
        // Fallback to plain text
        setHtml(`<pre><code>${content}</code></pre>`);
      }
    };
    
    highlight();
  }, [content, language, codeToHtml]);
  
  return (
    <div className="h-full relative">
      {html && html.trim() ? (
        <div 
          className="h-full overflow-auto p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre font-mono h-full overflow-auto p-4">
          {content}
        </pre>
      )}
    </div>
  );
}