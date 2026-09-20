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
import { CornerDownLeft, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { TextSelectionSnapshot } from "./useTextSelection";

interface SelectionActionPopoverProps {
  selection: TextSelectionSnapshot | null;
  onSubmit: (instruction: string, selection: TextSelectionSnapshot) => void;
  /** Called when the control is closed without sending. */
  onDismiss: () => void;
  /**
   * A document whose presses count as outside presses although they never
   * bubble to the top-level page, such as a same-origin preview iframe.
   */
  pressDocument?: Document | null;
}

const surface =
  "z-50 rounded-lg border border-neutral-200/80 dark:border-neutral-700/70 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-lg shadow-lg shadow-black/10 dark:shadow-black/40";

/**
 * A small control floating above highlighted text: a pill that expands into
 * a one-line instruction input. The snapshot is latched when the pill opens,
 * so focusing the input (which collapses the document selection) keeps it.
 */
export function SelectionActionPopover({
  selection,
  onSubmit,
  onDismiss,
  pressDocument,
}: SelectionActionPopoverProps) {
  const [latched, setLatched] = useState<TextSelectionSnapshot | null>(null);
  const [instruction, setInstruction] = useState("");
  const active = latched ?? selection;
  const open = !!active;

  const close = () => {
    setLatched(null);
    setInstruction("");
    onDismiss();
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) close();
    },
    placement: "top",
    strategy: "fixed",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const { getFloatingProps } = useInteractions([dismiss]);

  // Presses inside a nested document are invisible to the top-level dismiss
  // handler, so watch that document directly while the control is open.
  useEffect(() => {
    if (!open || !pressDocument || pressDocument === document) return;
    const onPress = () => close();
    pressDocument.addEventListener("pointerdown", onPress, true);
    return () => pressDocument.removeEventListener("pointerdown", onPress, true);
  });

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

  if (!open || !active) return null;

  const submit = () => {
    const text = instruction.trim();
    if (!text || !latched) return;
    onSubmit(text, latched);
    setLatched(null);
    setInstruction("");
  };

  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className={cn(surface, "p-1")}>
        {latched ? (
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
              placeholder="What should change?"
              aria-label="Edit instruction"
              className="w-64 max-w-[70vw] bg-transparent py-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none placeholder:text-neutral-400"
            />
            <button
              type="submit"
              disabled={!instruction.trim()}
              aria-label="Send edit"
              title="Send"
              className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
            >
              <CornerDownLeft size={13} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            // Keep the document selection: a default mousedown would collapse it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selection && setLatched(selection)}
            aria-label="Edit selection"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <Sparkles size={12} className="text-violet-500" />
            Edit
          </button>
        )}
      </div>
    </FloatingPortal>
  );
}
