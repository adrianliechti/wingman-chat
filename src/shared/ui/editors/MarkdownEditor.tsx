import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { Markdown } from "@/shared/ui/Markdown";
import { CodeEditor } from "./CodeEditor";

// Component to display Markdown content as rendered HTML
function MarkdownPreview({
  content,
  path,
  onSelectionRoot,
}: {
  content: string;
  path?: string;
  onSelectionRoot?: (element: HTMLElement | null) => void;
}) {
  const { fs } = useArtifacts();
  return (
    <div ref={onSelectionRoot} className="h-full overflow-auto px-3 py-2">
      <div className="prose prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0">
        <Markdown fs={fs ?? undefined} basePath={path}>
          {content}
        </Markdown>
      </div>
    </div>
  );
}

interface MarkdownEditorProps {
  content: string;
  path?: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
  /** Receives the element whose text selection the host watches. */
  onSelectionRoot?: (element: HTMLElement | null) => void;
}

export function MarkdownEditor({ content, path, viewMode = "preview", onSelectionRoot }: MarkdownEditorProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === "preview" ? (
          <MarkdownPreview content={content} path={path} onSelectionRoot={onSelectionRoot} />
        ) : (
          <CodeEditor content={content} language="markdown" onSelectionRoot={onSelectionRoot} />
        )}
      </div>
    </div>
  );
}
