import { memo } from "react";

interface TextEditorProps {
  content: string;
  /** Receives the element whose text selection the host watches. */
  onSelectionRoot?: (element: HTMLElement | null) => void;
}

export const TextEditor = memo(function TextEditor({ content, onSelectionRoot }: TextEditorProps) {
  return (
    <div ref={onSelectionRoot} className="h-full">
      <pre className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap font-mono h-full overflow-auto p-4">
        {content}
      </pre>
    </div>
  );
});
