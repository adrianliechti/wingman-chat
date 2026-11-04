import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";
import { CornerDownLeft, ListTree, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";

export interface Alternatives {
  /** Full replacements for `context`, with a short note on what each changes. */
  options: { text: string; keyChange: string }[];
  /** The passage (whole sentences) each option replaces. */
  context: string;
}

interface AlternativesPopoverProps {
  selection: TextSelectionSnapshot | null;
  /** Loads alternatives for the latched selection. */
  onLoadAlternatives: (selection: TextSelectionSnapshot) => Promise<Alternatives>;
  /** Applies one alternative; `context` is the passage it replaces. */
  onApply: (text: string, context: string) => void;
  /** Hovering an alternative shows it in place; null restores the text. */
  onPreview: (text: string | null, context: string) => void;
  /** Rewrites the selection with a free instruction. */
  onInstruction: (instruction: string, selection: TextSelectionSnapshot) => void;
  onDismiss: () => void;
}

type Mode =
  | { kind: "menu" }
  | { kind: "instruction" }
  | { kind: "alternatives"; data: Alternatives | null; error: string | null };

const surface =
  "z-50 rounded-lg border border-neutral-200/80 dark:border-neutral-700/70 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-lg shadow-lg shadow-black/10 dark:shadow-black/40";

/**
 * Floats above highlighted translation text: offers alternatives for the
 * passage or a one-line instruction. The selection is latched when either is
 * chosen, so focusing the control (which collapses the document selection)
 * keeps the passage.
 */
export function AlternativesPopover({
  selection,
  onLoadAlternatives,
  onApply,
  onPreview,
  onInstruction,
  onDismiss,
}: AlternativesPopoverProps) {
  const [latched, setLatched] = useState<TextSelectionSnapshot | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "menu" });
  const [instruction, setInstruction] = useState("");
  const active = latched ?? selection;
  const open = !!active;

  const close = () => {
    setLatched(null);
    setMode({ kind: "menu" });
    setInstruction("");
    onDismiss();
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) close();
    },
    placement: "bottom",
    strategy: "fixed",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const { getFloatingProps } = useInteractions([dismiss]);

  useEffect(() => {
    if (!active) return;
    const { top, left, width, height } = active.rect;
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
      }),
    });
  }, [active, refs]);

  // A new highlight while alternatives are open starts over with it.
  useEffect(() => {
    if (selection && latched && selection !== latched && mode.kind === "menu") setLatched(null);
  }, [selection, latched, mode.kind]);

  if (!open || !active) return null;

  const loadAlternatives = () => {
    setLatched(active);
    setMode({ kind: "alternatives", data: null, error: null });
    onLoadAlternatives(active)
      .then((data) => setMode({ kind: "alternatives", data, error: null }))
      .catch((error: unknown) =>
        setMode({
          kind: "alternatives",
          data: null,
          error: error instanceof Error ? error.message : "Couldn't load alternatives.",
        }),
      );
  };

  const submit = () => {
    const text = instruction.trim();
    if (!text || !latched) return;
    onInstruction(text, latched);
    close();
  };

  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className={cn(surface, "p-1")}>
        {mode.kind === "instruction" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex items-center gap-1.5 pl-2"
          >
            <Sparkles size={13} className="shrink-0 text-violet-500" />
            <input
              autoFocus
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              placeholder="How should this passage change?"
              aria-label="Rewrite instruction"
              className="w-64 max-w-[70vw] bg-transparent py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
            />
            <button
              type="submit"
              disabled={!instruction.trim()}
              aria-label="Rewrite"
              title="Rewrite"
              className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <CornerDownLeft size={13} />
            </button>
          </form>
        ) : mode.kind === "alternatives" ? (
          <div className="max-h-72 w-80 max-w-[85vw] overflow-y-auto">
            {mode.data === null && mode.error === null && (
              <div className="flex items-center justify-center gap-2 py-5 text-sm text-neutral-500">
                <Loader2 size={14} className="animate-spin" />
                Finding alternatives…
              </div>
            )}
            {mode.error && <div className="px-3 py-4 text-sm text-red-600 dark:text-red-400">{mode.error}</div>}
            {mode.data && mode.data.options.length === 0 && (
              <div className="px-3 py-5 text-center text-sm text-neutral-500">No alternatives for this passage.</div>
            )}
            {mode.data?.options.map((option, index) => (
              <button
                key={`${index}:${option.text}`}
                type="button"
                onMouseEnter={() => onPreview(option.text, mode.data!.context)}
                onMouseLeave={() => onPreview(null, mode.data!.context)}
                onFocus={() => onPreview(option.text, mode.data!.context)}
                onBlur={() => onPreview(null, mode.data!.context)}
                onClick={() => {
                  onApply(option.text, mode.data!.context);
                  close();
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-neutral-800 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/5"
              >
                <span className="block leading-snug">{option.keyChange || option.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              // Keep the document selection: a default mousedown would collapse it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={loadAlternatives}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"
            >
              <ListTree size={12} className="text-neutral-500" />
              Alternatives
            </button>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLatched(active);
                setMode({ kind: "instruction" });
              }}
              aria-label="Rewrite the selection with an instruction"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"
            >
              <Sparkles size={12} className="text-violet-500" />
              Rewrite
            </button>
          </div>
        )}
      </div>
    </FloatingPortal>
  );
}
