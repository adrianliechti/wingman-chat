import { Transition } from "@headlessui/react";
import { ChevronLeft } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface PanelShellProps {
  open: boolean;
  /** Panel width on desktop, in vw. Small screens use the full width. */
  widthVw: number;
  /** Extra distance from the right edge, in vw, e.g. the open agent drawer's width. */
  offsetVw?: number;
  /** A drag on this or a sibling panel is in progress: follow instantly, no transition. */
  resizing?: boolean;
  /** Small-screen layout: full width below the 3rem top bar, no resize handle. */
  compact: boolean;
  /** Keep the content mounted while closed (for iframes); otherwise it mounts only while open. */
  keepMounted?: boolean;
  /** Stacking class for the shell, e.g. "z-20". */
  className?: string;
  resizeLabel: string;
  onResizeStart?: MouseEventHandler<HTMLButtonElement>;
  /** Renders a "Back" bar on small screens, where the panel covers the whole page. */
  onClose?: () => void;
  /** Edge latch attached to the shell's left edge; rendered last so it paints above the resize handle. */
  latch?: ReactNode;
  children: ReactNode;
}

/**
 * Positioned shell for a right-side panel (artifacts, app, agent).
 *
 * The shell is always mounted and placed with `translate` alone: closed shells sit just
 * off-screen, open ones are pulled in, and an offset makes room for the agent drawer.
 * Everything that moves therefore animates on the compositor with one duration and
 * easing, so panels, the agent drawer and the latches stay in lockstep even while the
 * main thread is busy mounting drawer content. Only the content fades.
 */
export function PanelShell({
  open,
  widthVw,
  offsetVw = 0,
  resizing,
  compact,
  keepMounted,
  className,
  resizeLabel,
  onResizeStart,
  onClose,
  latch,
  children,
}: PanelShellProps) {
  const away = open ? "0%" : "100%";
  const translate = offsetVw ? `calc(${away} - ${offsetVw}vw) 0` : `${away} 0`;
  const fade = !resizing && "transition-opacity duration-500 ease-in-out";
  const content = (
    <>
      {!compact && onResizeStart && (
        <button
          type="button"
          aria-label={resizeLabel}
          className="group absolute top-0 bottom-0 -left-2 z-10 flex w-4 cursor-ew-resize items-center justify-center"
          onMouseDown={onResizeStart}
        >
          <div className="z-10 rounded-sm bg-neutral-300 opacity-60 shadow-sm dark:bg-neutral-700">
            <div className="grid grid-cols-1 justify-items-center gap-0.5 px-0.5 py-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
              ))}
            </div>
          </div>
        </button>
      )}
      <div className="flex h-full flex-col overflow-hidden border-l border-black/10 dark:border-white/10">
        {onClose && (
          <div className="mt-4 flex h-10 items-center border-b border-neutral-200/60 bg-white/90 px-2 backdrop-blur-sm md:hidden dark:border-neutral-700/60 dark:bg-neutral-900/90">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded p-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            >
              <ChevronLeft size={16} />
              <span>Back</span>
            </button>
          </div>
        )}
        <div className={cn("min-h-0 flex-1 overflow-hidden", resizing && "pointer-events-none")}>{children}</div>
      </div>
    </>
  );
  return (
    <div
      className={cn(
        "fixed right-0 max-w-none md:top-14 md:bottom-0",
        !resizing && "transition-[translate] duration-500 ease-in-out",
        compact && "w-full",
        className,
      )}
      style={{
        width: compact ? undefined : `${widthVw}vw`,
        translate,
        top: compact ? "48px" : undefined,
        bottom: compact ? 0 : undefined,
      }}
    >
      {keepMounted ? (
        <div className={cn("h-full", fade, open ? "opacity-100" : "pointer-events-none opacity-0")}>{content}</div>
      ) : (
        <Transition
          show={open}
          as="div"
          className="h-full"
          enter={cn(fade)}
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave={cn(fade)}
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          {content}
        </Transition>
      )}
      {latch}
    </div>
  );
}
