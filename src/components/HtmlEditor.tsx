import { CodeEditor } from './CodeEditor';

// Component to display HTML content in iframe
function HtmlPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-hidden">
      <iframe
        srcDoc={content}
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto">
        {viewMode === 'preview' ? (
          <HtmlPreview content={content} />
        ) : (
          <CodeEditor content={content} language="html" />
        )}
      </div>
    </div>
  );
}
