import { useMemo } from 'react';
import { CodeEditor } from './CodeEditor';
import { useArtifacts } from '../hooks/useArtifacts';
import { transformHtmlForPreview } from '../lib/artifacts';

// Component to display HTML content in iframe with virtual filesystem support
function HtmlPreview({ content }: { content: string }) {
  const { fs } = useArtifacts();

  // Get all files from the filesystem
  const files = useMemo(() => fs.listFiles().reduce((acc, file) => {
    acc[file.path] = file;
    return acc;
  }, {} as Record<string, { path: string; content: string; contentType?: string }>), [fs]);

  // Transform HTML content with data URLs for artifact references
  // Data URLs don't need cleanup (unlike blob URLs)
  const transformedHtml = useMemo(() => {
    return transformHtmlForPreview(content, files).html;
  }, [content, files]);

  return (
    <div className="h-full overflow-hidden">
      <iframe
        srcDoc={transformedHtml}
        className="w-full h-full"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}

interface HtmlEditorProps {
  content: string;
  viewMode?: 'code' | 'preview';
  onViewModeChange?: (mode: 'code' | 'preview') => void;
}

export function HtmlEditor({ content, viewMode = 'preview' }: HtmlEditorProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {viewMode === 'preview' ? (
        <HtmlPreview content={content} />
      ) : (
        <CodeEditor content={content} language="html" />
      )}
    </div>
  );
}
