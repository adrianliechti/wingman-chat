import { useState, useEffect } from 'react';
import { Code, Eye } from 'lucide-react';
import { Button } from '@headlessui/react';
import { CodeEditor } from './CodeEditor';

// Component to display HTML content in iframe
function HtmlPreview({ blob }: { blob: Blob }) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHtml = async () => {
      try {
        const text = await blob.text();
        setHtmlContent(text);
      } catch {
        setHtmlContent('<p>Error loading HTML content</p>');
      } finally {
        setLoading(false);
      }
    };

    loadHtml();
  }, [blob]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-neutral-500">Loading preview...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <iframe
        srcDoc={htmlContent}
        className="w-full h-full"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}

interface HtmlEditorProps {
  blob: Blob;
}

export function HtmlEditor({ blob }: HtmlEditorProps) {
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Subtle View Mode Toggle - Top Right */}
      <div className="absolute top-2 right-2 z-10">
        <Button
          onClick={() => setViewMode(viewMode === 'code' ? 'preview' : 'code')}
          className="p-1.5 rounded-md transition-colors bg-white/80 dark:bg-neutral-700/80 backdrop-blur-sm border border-neutral-200/50 dark:border-neutral-500/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-600/80"
          title={viewMode === 'code' ? 'Switch to preview' : 'Switch to code'}
        >
          {viewMode === 'code' ? <Eye size={16} /> : <Code size={16} />}
        </Button>
      </div>
      
      <div className="flex-1 overflow-auto">
        {viewMode === 'preview' ? (
          <HtmlPreview blob={blob} />
        ) : (
          <CodeEditor blob={blob} language="html" />
        )}
      </div>
    </div>
  );
}
