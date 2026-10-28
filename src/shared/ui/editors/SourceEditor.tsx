import { Bold, Code, Italic, Link, Strikethrough } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useHighlight } from "@/shared/hooks/useHighlight";
import { HighlightStyles } from "@/shared/ui/HighlightStyles";
import { cn } from "@/shared/lib/cn";
import { lineAt } from "@/shared/lib/markdownBlocks";
import {
  continueListOnEnter,
  shiftListItems,
  toggleInlineFormat,
  type InlineFormat,
} from "@/shared/lib/markdownFormatting";
import { detectIndent, indentSelection, newlineWithIndent, type SourceEdit } from "@/shared/lib/sourceEditing";
import { SelectionActionPopover, type SelectionAction } from "@/shared/ui/selection/SelectionActionPopover";
import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import type { TextDraft } from "./useTextDraft";

const CODE_FONT: React.CSSProperties = {
  fontFamily: "Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace",
  fontVariantLigatures: "none",
};

/** Viewport box of the character at `offset` in the mirrored text. */
function characterRect(mirror: HTMLElement, offset: number): TextSelectionSnapshot["rect"] | null {
  const doc = mirror.ownerDocument;
  const walker = doc.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining < length) {
      const range = doc.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 1);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: Math.max(rect.width, 1), height: rect.height };
    }
    remaining -= length;
  }
  return null;
}

/**
 * Applies a source edit through `insertText`, so it lands in the textarea's
 * own undo history, then places the edit's selection.
 */
function applyEdit(textarea: HTMLTextAreaElement, edit: SourceEdit) {
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  if (!textarea.ownerDocument.execCommand("insertText", false, edit.insert)) {
    textarea.setRangeText(edit.insert, edit.from, edit.to, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selection.start, edit.selection.end);
}

function formatShortcut(event: KeyboardEvent): InlineFormat | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === "x" ? "strike" : null;
  if (key === "b") return "bold";
  if (key === "i") return "italic";
  if (key === "e") return "code";
  if (key === "k") return "link";
  return null;
}

/**
 * The edit a key press makes, if any. Markdown continues lists and formats
 * text; other sources keep indentation (code also opens blocks) and indent
 * with Tab.
 */
function keyEdit(event: KeyboardEvent<HTMLTextAreaElement>, language: string | undefined): SourceEdit | null {
  const { value, selectionStart: start, selectionEnd: end } = event.currentTarget;
  if (event.nativeEvent.isComposing) return null;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  const direction = event.shiftKey ? -1 : 1;
  if (language === "markdown") {
    if (event.key === "Enter" && plain && !event.shiftKey) return continueListOnEnter(value, start, end);
    if (event.key === "Tab" && plain) return shiftListItems(value, start, end, direction);
    const format = formatShortcut(event);
    return format ? toggleInlineFormat(value, start, end, format) : null;
  }
  const code = language && language !== "text" ? language : undefined;
  if (event.key === "Enter" && plain && !event.shiftKey) return newlineWithIndent(value, start, end, code);
  if (event.key === "Tab" && plain) {
    const fallback = code === "py" || code === "python" ? "    " : code ? "  " : "\t";
    return indentSelection(value, start, end, detectIndent(value, fallback), direction);
  }
  return null;
}

const FORMATS: Array<{ format: InlineFormat; label: string; icon: React.ReactNode }> = [
  { format: "bold", label: "Bold (⌘B)", icon: <Bold size={13} /> },
  { format: "italic", label: "Italic (⌘I)", icon: <Italic size={13} /> },
  { format: "strike", label: "Strikethrough (⌘⇧X)", icon: <Strikethrough size={13} /> },
  { format: "code", label: "Code (⌘E)", icon: <Code size={13} /> },
  { format: "link", label: "Link (⌘K)", icon: <Link size={13} /> },
];

interface SourceSelection {
  start: number;
  end: number;
  rect: TextSelectionSnapshot["rect"];
}

interface SourceEditorProps {
  value: string;
  /** A syntax-highlight language id or alias (`py`, `html`, `markdown`, …); none for plain text. */
  language?: string;
  /** Absent for a read-only view. */
  onChange?: (value: string) => void;
  /** `document` fills and scrolls its container; `block` grows with its text inside rendered prose. */
  variant: "document" | "block";
  label: string;
  placeholder?: string;
  /** Focuses the textarea with the caret at `caret` whenever `id` changes. */
  focusRequest?: { id: number; caret: number };
  /** Source line of the first line of `value`, so instructions cite lines of the whole file. */
  firstLine?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  /** Sends an instruction about the selected text to the conversation. */
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/**
 * A source editor: a native textarea with transparent text over a
 * syntax-highlighted mirror of the same text. Selecting text offers the
 * select-to-edit instruction and, for markdown, inline formatting.
 */
export function SourceEditor({
  value,
  language,
  onChange,
  variant,
  label,
  placeholder,
  focusRequest,
  firstLine = 1,
  onKeyDown,
  onBlur,
  onAsk,
}: SourceEditorProps) {
  const markdown = language === "markdown";
  const fencedCode = markdown && /^ {0,3}(?:`{3,}|~{3,})/.test(value);
  const wrap = (variant === "block" && !fencedCode) || !language || language === "text" || language === "plaintext";
  // Inline prose keeps its text color; only structural Markdown markers are muted.
  const markup = variant === "block" && markdown;
  const tokens = useHighlight(value, language);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const [selection, setSelection] = useState<SourceSelection | null>(null);

  const focusId = focusRequest?.id;
  const focusCaret = focusRequest?.caret ?? 0;
  useEffect(() => {
    const textarea = textareaRef.current;
    if (focusId === undefined || !textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(focusCaret, focusCaret);
    textarea.scrollIntoView({ block: "nearest" });
  }, [focusId, focusCaret]);

  const report = (textarea: HTMLTextAreaElement) => {
    const { selectionStart: start, selectionEnd: end } = textarea;
    const mirror = mirrorRef.current;
    if (start === end || !mirror || !textarea.value.slice(start, end).trim()) {
      setSelection(null);
      return;
    }
    const rect = characterRect(mirror, start);
    setSelection(rect ? { start, end, rect } : null);
  };

  const format = (kind: InlineFormat) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyEdit(textarea, toggleInlineFormat(textarea.value, textarea.selectionStart, textarea.selectionEnd, kind));
    report(textarea);
  };

  const snapshot: TextSelectionSnapshot | null = selection
    ? {
        text: value.slice(selection.start, selection.end),
        rect: selection.rect,
        lines: {
          start: firstLine - 1 + lineAt(value, selection.start),
          end: firstLine - 1 + lineAt(value, Math.max(selection.start, selection.end - 1)),
        },
      }
    : null;
  const actions: SelectionAction[] | undefined =
    onChange && markdown
      ? FORMATS.map((item) => ({
          id: item.format,
          label: item.label,
          icon: item.icon,
          onRun: () => format(item.format),
        }))
      : undefined;

  const layout = cn(
    "m-0 block w-full border-0 [tab-size:4]",
    wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
    variant === "document" ? "p-4 text-sm leading-5" : "p-0 [font:inherit] [letter-spacing:inherit]",
  );
  const font = variant === "document" ? CODE_FONT : undefined;

  return (
    <div
      className={cn(variant === "document" ? "h-full overflow-auto" : !wrap && "overflow-x-auto")}
      onScroll={variant === "document" ? () => setSelection(null) : undefined}
    >
      <HighlightStyles />
      <div className={cn("relative", variant === "document" && "min-h-full", !wrap && "w-max min-w-full")}>
        <pre
          ref={mirrorRef}
          aria-hidden
          style={font}
          className={cn(layout, "pointer-events-none", !markup && "syntax-highlight")}
        >
          {tokens
            ? tokens.map((token, index) => {
                const className = markup
                  ? token.className === "meta" && "text-neutral-400 dark:text-neutral-500"
                  : token.className && `th-${token.className}`;
                return className ? (
                  <span key={index} className={className}>
                    {token.value}
                  </span>
                ) : (
                  token.value
                );
              })
            : value}
          {/* A trailing newline needs a character after it to take up its line. */}
          {!value || value.endsWith("\n") ? " " : null}
        </pre>
        <textarea
          ref={textareaRef}
          value={value}
          readOnly={!onChange}
          wrap={wrap ? "soft" : "off"}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            const edit = onChange ? keyEdit(event, language) : null;
            if (edit) {
              event.preventDefault();
              applyEdit(event.currentTarget, edit);
              report(event.currentTarget);
              return;
            }
            // Escape releases the textarea, so Tab moves focus on again.
            if (event.key === "Escape" && variant === "document") {
              event.currentTarget.blur();
              return;
            }
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => report(event.currentTarget)}
          onMouseUp={(event) => report(event.currentTarget)}
          onTouchEnd={(event) => report(event.currentTarget)}
          onBlur={onBlur}
          // The textarea is as tall as its text; a scroll offset would detach it from the mirror.
          onScroll={(event) => {
            event.currentTarget.scrollTop = 0;
            event.currentTarget.scrollLeft = 0;
          }}
          aria-label={label}
          placeholder={placeholder}
          spellCheck={variant === "block" || !language || language === "text"}
          autoCapitalize="off"
          autoCorrect="off"
          style={font}
          className={cn(
            layout,
            "absolute inset-0 h-full resize-none overflow-hidden bg-transparent text-transparent outline-none",
            "caret-neutral-900 dark:caret-neutral-100 selection:bg-sky-400/30 placeholder:text-neutral-400",
          )}
        />
      </div>
      {(actions || onAsk) && (
        <SelectionActionPopover
          selection={snapshot}
          actions={actions}
          onSubmit={
            onAsk
              ? (instruction, latched) => {
                  onAsk(instruction, latched);
                  setSelection(null);
                }
              : undefined
          }
          onDismiss={() => setSelection(null)}
        />
      )}
    </div>
  );
}

interface DraftSourceEditorProps {
  draft: TextDraft;
  language?: string;
  label: string;
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/**
 * A whole file's source bound to its draft. The assistant reads the file, so
 * unsaved edits are saved before it is asked about a selection.
 */
export function DraftSourceEditor({ draft, language, label, onAsk }: DraftSourceEditorProps) {
  return (
    <SourceEditor
      variant="document"
      label={label}
      language={language}
      value={draft.text}
      onChange={draft.change}
      onAsk={
        onAsk
          ? (instruction, selection) => {
              draft.save();
              onAsk(instruction, selection);
            }
          : undefined
      }
    />
  );
}
