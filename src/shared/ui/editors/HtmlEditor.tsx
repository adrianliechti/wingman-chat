import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import { CodeEditor } from "./CodeEditor";

interface HtmlEditorProps {
  path: string;
  content: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
}

export function HtmlEditor({ path, content, viewMode = "preview" }: HtmlEditorProps) {
  const { fs } = useArtifacts();

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {viewMode === "preview" ? (
        <HtmlPreview path={path} content={content} fs={fs} className="w-full h-full" />
      ) : (
        <CodeEditor content={content} language="html" />
      )}
    </div>
  );
}
