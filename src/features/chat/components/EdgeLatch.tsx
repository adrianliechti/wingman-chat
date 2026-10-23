import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface EdgeLatchProps {
  /** Panel name shown on the tab (truncated when long) and used for the accessible "Open …" / "Close …" label. */
  label: string;
  /** Noun for the tooltip and accessible name; defaults to the lowercased label. */
  name?: string;
  icon: ReactNode;
  open: boolean;
  /** The latch cannot be shown, e.g. another panel covers the whole screen. */
  hidden?: boolean;
  /**
   * Width in vw of an open sibling panel. The latch then rides along to that panel's
   * left edge so every tab stays reachable while a sibling panel is open.
   */
  shiftVw?: number;
  /** A drag is in progress: follow the sibling's edge instantly. */
  resizing?: boolean;
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
export function EdgeLatch({
  label,
  name,
  icon,
  open,
  hidden,
  shiftVw = 0,
  resizing,
  compact,
  slot = 0,
  onClick,
}: EdgeLatchProps) {
  const action = `${open ? "Close" : "Open"} ${name ?? label.toLowerCase()}`;
  // Faded out when unavailable, or off-screen behind a full-width compact panel.
  const inactive = hidden || (compact && open);
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
        "absolute -left-6.75 z-10 flex w-7 flex-col items-center justify-center gap-2 rounded-l-lg border border-r-0 border-black/10 dark:border-white/10",
        // The open tab takes the panel's surface so it reads as part of it; the others stay recessed.
        open
          ? "bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50"
          : "border-neutral-300/20 bg-neutral-200/30 text-neutral-500 shadow-sm backdrop-blur-sm hover:text-neutral-800 dark:border-neutral-700/20 dark:bg-neutral-800/40 dark:text-neutral-400 dark:hover:text-neutral-100",
        resizing
          ? "[transition:opacity_500ms_var(--ease-in-out),color_150ms_var(--ease-out),background-color_150ms_var(--ease-out)]"
          : "[transition:opacity_500ms_var(--ease-in-out),color_150ms_var(--ease-out),background-color_150ms_var(--ease-out),translate_500ms_var(--ease-in-out)]",
        compact ? "h-11" : "h-32 py-3",
        inactive ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      // Keep the shadow off the panel edge the tab is attached to.
      style={{
        top: slotTop(slot, !!compact),
        translate: shiftVw ? `${-shiftVw}vw 0` : undefined,
        clipPath: "inset(-8px 0 -8px -8px)",
      }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {open ? <ChevronRight size={16} className="translate-x-0.5" /> : icon}
      </span>
      {!compact && (
        <span
          className={cn(
            "min-h-0 overflow-hidden text-[11px] tracking-wide text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180 select-none",
            open ? "font-semibold" : "font-medium",
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
}
