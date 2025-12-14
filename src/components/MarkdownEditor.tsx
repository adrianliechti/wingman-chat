import { CodeEditor } from './CodeEditor';
import { Markdown } from './Markdown';

// Component to display Markdown content as rendered HTML
function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto px-3 py-2">
      <div className="prose prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}

interface MarkdownEditorProps {
  content: string;
  viewMode?: 'code' | 'preview';
  onViewModeChange?: (mode: 'code' | 'preview') => void;
}

export function MarkdownEditor({ content, viewMode = 'preview' }: MarkdownEditorProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === 'preview' ? (
          <MarkdownPreview content={content} />
        ) : (
          <CodeEditor content={content} language="markdown" />
        )}
      </div>
    </div>
  );
}
