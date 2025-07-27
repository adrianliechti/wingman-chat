import { useState, useEffect } from 'react';
import { Editor } from './Editor';

interface CodeEditorProps {
  blob: Blob;
  language?: string;
}

export function CodeEditor({ blob, language = '' }: CodeEditorProps) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Read blob content
  useEffect(() => {
    const readBlob = async () => {
      setIsLoading(true);
      try {
        const text = await blob.text();
        setContent(text);
      } catch {
        setContent('Error reading file content');
      } finally {
        setIsLoading(false);
      }
    };
    
    readBlob();
  }, [blob]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-neutral-500 dark:text-neutral-400">Loading...</div>
      </div>
    );
  }
  
  return (
    <div className="h-full relative">
      <Editor
        language={language}
        value={content}
        readOnly={true}
      />
    </div>
  );
}