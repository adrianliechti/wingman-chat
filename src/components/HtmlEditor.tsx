import { useMemo, useState, useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { useArtifacts } from '../hooks/useArtifacts';
import { transformHtmlForPreview } from '../lib/artifacts';
import type { File } from '../types/file';

// Component to display HTML content in iframe with virtual filesystem support
function HtmlPreview({ content }: { content: string }) {
  const { fs, version } = useArtifacts();
  const [files, setFiles] = useState<Record<string, File>>({});

  // Load files asynchronously
  useEffect(() => {
    let cancelled = false;
    
    async function loadFiles() {
      if (!fs) {
        setFiles({});
        return;
      }
      
      try {
        const fileList = await fs.listFiles();
        if (!cancelled) {
          const fileMap = fileList.reduce((acc, file) => {
            acc[file.path] = file;
            return acc;
          }, {} as Record<string, File>);
          setFiles(fileMap);
        }
      } catch (error) {
        console.error('Error loading files:', error);
        if (!cancelled) {
          setFiles({});
        }
      }
    }
    
    loadFiles();
    
    return () => {
      cancelled = true;
    };
  }, [fs, version]);

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
