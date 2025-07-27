import { memo } from 'react';
import { CopyButton } from './CopyButton';
import { Editor } from './Editor';

interface CodeRendererProps {
  code: string;
  language: string;
}

const CodeRenderer = memo(({ code, language }: CodeRendererProps) => {
  const renderCodeBlock = (content: React.ReactNode) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-3 pr-1 py-0.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>{language}</span>
        <div className="flex items-center">
          <CopyButton text={code} size={2} />
        </div>
      </div>
      <div className="bg-white dark:bg-neutral-900 rounded-b-md overflow-hidden border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {content}
      </div>
    </div>
  );

  return renderCodeBlock(
    <Editor
      value={code}
      language={language}
      readOnly={true}
      height="auto"
      options={{
        lineNumbers: 'off',
        folding: false,
        renderLineHighlight: 'none',
        hideCursorInOverviewRuler: true,
        overviewRulerLanes: 0,
        selectOnLineNumbers: false,
        selectionHighlight: false,
      }}
    />
  );
});

CodeRenderer.displayName = 'CodeRenderer';

export { CodeRenderer };