import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import { DraftSourceEditor } from "./SourceEditor";
import { useTextDraft, type FileEditing } from "./useTextDraft";

// Component to display SVG content
function SvgPreview({ content }: { content: string }) {
  // Make SVG responsive by removing fixed dimensions and adding responsive styles
  const svgContent = content.replace(/<svg([^>]*)>/i, (_, attributes) => {
    // Remove width and height attributes but keep viewBox
    const newAttributes = attributes.replace(/\s*width\s*=\s*"[^"]*"/gi, "").replace(/\s*height\s*=\s*"[^"]*"/gi, "");

    // Add responsive styling
    return `<svg${newAttributes} style="width: 100%; height: 100%; max-width: 100%; max-height: 100%;">`;
  });

  const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

  return (
    <div className="h-full p-4">
      <img src={previewUrl} alt="SVG preview" className="w-full h-full object-contain" />
    </div>
  );
}

interface SvgEditorProps {
  content: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
  /** How the file is saved; without it the editor is read-only. */
  editing?: FileEditing;
  /** Sends an instruction about code selected in the code view. */
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

export function SvgEditor({ content, viewMode = "preview", editing, onAsk }: SvgEditorProps) {
  const draft = useTextDraft(content, editing);
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === "preview" ? (
          <SvgPreview content={draft.text} />
        ) : (
          <DraftSourceEditor draft={draft} language="xml" label="SVG source" onAsk={onAsk} />
        )}
      </div>
    </div>
  );
}
