import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface EdgeLatchProps {
  /** Panel name shown on the tab and used for the accessible "Open …" / "Close …" label. */
  label: string;
  icon: ReactNode;
  open: boolean;
  /** Another panel occupies the right edge, so this latch fades out of the way. */
  hidden?: boolean;
  /** Icon-only handle for small screens, where an open panel covers the viewport. */
  compact?: boolean;
  /** Vertical position: slot 0 is the first tab, slot 1 stacks below it. */
  slot?: number;
  onClick: () => void;
}

/**
 * Tab offset inside its panel shell. Desktop shells start below the 3.5rem top bar and
 * compact ones below the 3rem bar, so every first tab lands at max(4rem, 25vh - 4rem)
 * from the viewport top; later slots stack by the tab height plus a 0.5rem gap.
 */
function slotTop(slot: number, compact: boolean): string {
  const [offset, step] = compact ? [1, 3.25] : [0.5, 8.5];
  const rem = offset + slot * step;
  return `max(${rem}rem, calc(25vh + ${rem - 8}rem))`;
}

/**
 * Slim handle attached to the left edge of a right-side panel shell. The shell is
 * always mounted and slides off-screen when closed, which leaves exactly this tab
 * showing at the viewport edge; because the tab is part of the shell it moves with
 * the panel through every open and close animation instead of being re-created.
 *
 * Both glyphs live in one fixed 16px slot and cross-fade, so the tab never changes
 * size when it switches between "open" and "close".
 */
export function EdgeLatch({ label, icon, open, hidden, compact, slot = 0, onClick }: EdgeLatchProps) {
  const action = `${open ? "Close" : "Open"} ${label.toLowerCase()}`;
  // Faded out for a sibling panel, or off-screen behind a full-width compact panel.
  const inactive = hidden || (compact && open);
  const fade = "[transition:opacity_500ms_var(--ease-in-out)]";
  return (
    <button
      type="button"
      onClick={onClick}
      title={action}
      aria-label={action}
      aria-expanded={open}
      aria-hidden={inactive || undefined}
      tabIndex={inactive ? -1 : undefined}
      className={cn(
        "group absolute -left-6.75 z-10 flex w-7 flex-col items-center justify-center gap-2 rounded-l-lg border border-r-0 border-black/10 bg-neutral-100 text-neutral-500 shadow-sm hover:text-neutral-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100",
        "[transition:opacity_500ms_var(--ease-in-out),color_150ms_var(--ease-out)]",
        compact ? "h-11" : "h-32",
        inactive ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      // Keep the shadow off the panel edge the tab is attached to.
      style={{ top: slotTop(slot, !!compact), clipPath: "inset(-8px 0 -8px -8px)" }}
    >
      <span className="relative h-4 w-4 shrink-0">
        <span className={cn("absolute inset-0 flex items-center justify-center", fade, open && "opacity-0")}>
          {icon}
        </span>
        <ChevronRight
          size={16}
          className={cn(
            "absolute inset-0 group-hover:translate-x-0.5",
            "[transition:opacity_500ms_var(--ease-in-out),translate_150ms_var(--ease-out)]",
            !open && "opacity-0",
          )}
        />
      </span>
      {!compact && (
        <span className="text-[11px] font-medium tracking-wide [writing-mode:vertical-rl] rotate-180 select-none">
          {label}
        </span>
      )}
    </button>
  );
}
