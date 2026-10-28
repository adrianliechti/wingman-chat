import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import { DraftSourceEditor } from "./SourceEditor";
import { useTextDraft, type FileEditing } from "./useTextDraft";

interface TextEditorProps {
  content: string;
  /** A shiki language id or alias for source files; none for plain text. */
  language?: string;
  /** How the file is saved; without it the editor is read-only. */
  editing?: FileEditing;
  /** Sends an instruction about the selected text to the conversation. */
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/** Plain text and source files, edited in place. */
export function TextEditor({ content, language, editing, onAsk }: TextEditorProps) {
  const draft = useTextDraft(content, editing);
  return <DraftSourceEditor draft={draft} language={language} label={language ? "Source" : "Text"} onAsk={onAsk} />;
}
