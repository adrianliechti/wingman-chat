import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import { CodeEditor } from "./CodeEditor";

interface HtmlEditorProps {
  path: string;
  content: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
  /** Receives the preview iframe or the code view whose text selection the host watches. */
  onSelectionRoot?: (element: HTMLElement | null) => void;
}

export function HtmlEditor({ path, content, viewMode = "preview", onSelectionRoot }: HtmlEditorProps) {
  const { fs } = useArtifacts();

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {viewMode === "preview" ? (
        <HtmlPreview
          path={path}
          content={content}
          fs={fs ?? undefined}
          className="w-full h-full"
          iframeRef={onSelectionRoot}
        />
      ) : (
        <CodeEditor content={content} language="html" onSelectionRoot={onSelectionRoot} />
      )}
    </div>
  );
}
