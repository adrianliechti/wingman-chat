import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { Markdown } from "@/shared/ui/Markdown";
import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import { MarkdownBlockEditor } from "./MarkdownBlockEditor";
import { DraftSourceEditor } from "./SourceEditor";
import { useTextDraft, type FileEditing } from "./useTextDraft";

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
    <div className="@container h-full overflow-auto">
      {/* The same reading column as the block editor, so switching views keeps the text in place. */}
      <div ref={onSelectionRoot} className="mx-auto max-w-225 px-2 py-6 @[600px]:px-12">
        <div className="prose prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0">
          <Markdown fs={fs ?? undefined} basePath={path}>
            {content}
          </Markdown>
        </div>
      </div>
    </div>
  );
}

interface MarkdownEditorProps {
  content: string;
  path?: string;
  viewMode?: "code" | "preview";
  /** Receives the element whose text selection the host watches (read-only preview only). */
  onSelectionRoot?: (element: HTMLElement | null) => void;
  /** How the file is saved; without it the editor is read-only. */
  editing?: FileEditing;
  /** Sends an instruction about selected text to the conversation. */
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/**
 * Markdown files: the preview is edited in place, block by block, and the
 * code view edits the whole source. Without `editing` (an archived revision,
 * extracted office text) the preview is plain rendered markdown.
 */
export function MarkdownEditor({
  content,
  path,
  viewMode = "preview",
  onSelectionRoot,
  editing,
  onAsk,
}: MarkdownEditorProps) {
  const { fs } = useArtifacts();
  const draft = useTextDraft(content, editing);

  if (viewMode === "code") {
    return <DraftSourceEditor draft={draft} language="markdown" label="Markdown source" onAsk={onAsk} />;
  }
  if (!draft.change) {
    return <MarkdownPreview content={draft.text} path={path} onSelectionRoot={onSelectionRoot} />;
  }
  // The assistant reads the file, so unsaved edits are saved before it is asked.
  const ask = onAsk
    ? (instruction: string, selection: TextSelectionSnapshot) => {
        draft.save();
        onAsk(instruction, selection);
      }
    : undefined;
  return <MarkdownBlockEditor draft={draft} fs={fs ?? undefined} path={path} onAsk={ask} />;
}
