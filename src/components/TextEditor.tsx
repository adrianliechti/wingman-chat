interface TextEditorProps {
  content: string;
}

export function TextEditor({ content }: TextEditorProps) {
  return (
    <div className="h-full">
      <pre className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap font-mono h-full overflow-auto p-4">
        {content}
      </pre>
    </div>
  );
}
