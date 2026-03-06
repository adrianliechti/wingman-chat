import { useMemo, useState, useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { useArtifacts } from '@/features/artifacts/hooks/useArtifacts';
import { transformHtmlForPreview } from '@/features/artifacts/lib/artifacts';
import type { File } from '@/features/artifacts/types/file';

// Component to display HTML content in iframe with virtual filesystem support
function HtmlPreview({ content }: { content: string }) {
  const { fs } = useArtifacts();
  const [files, setFiles] = useState<Record<string, File>>({});

  // Load files on mount and subscribe to filesystem events
  useEffect(() => {
    let cancelled = false;

    const loadFiles = async () => {
      if (!fs) {
        if (!cancelled) setFiles({});
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
        if (!cancelled) setFiles({});
      }
    };

    // Load initial data
    loadFiles();

    // Subscribe to events for subsequent updates
    const unsubscribeCreated = fs.subscribe('fileCreated', loadFiles);
    const unsubscribeDeleted = fs.subscribe('fileDeleted', loadFiles);
    const unsubscribeRenamed = fs.subscribe('fileRenamed', loadFiles);
    const unsubscribeUpdated = fs.subscribe('fileUpdated', loadFiles);

    return () => {
      cancelled = true;
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs]);

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
