import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, className, side = "right" }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const handleMouseEnter = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const GAP = 6;
    let top = 0;
    let left = 0;
    if (side === "right") {
      top = rect.top + rect.height / 2;
      left = rect.right + GAP;
    } else if (side === "left") {
      top = rect.top + rect.height / 2;
      left = rect.left - GAP;
    } else if (side === "top") {
      top = rect.top - GAP;
      left = rect.left + rect.width / 2;
    } else {
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2;
    }
    setPos({ top, left });
  };

  const handleMouseLeave = () => setPos(null);

  const transformClass = {
    right: "-translate-y-1/2",
    left: "-translate-x-full -translate-y-1/2",
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
  }[side];

  const arrowClass = {
    right:
      "absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 border-4 border-transparent border-r-neutral-900 dark:border-r-neutral-700",
    left: "absolute right-0 top-1/2 translate-x-full -translate-y-1/2 border-4 border-transparent border-l-neutral-900 dark:border-l-neutral-700",
    top: "absolute bottom-0 left-1/2 translate-y-full -translate-x-1/2 border-4 border-transparent border-t-neutral-900 dark:border-t-neutral-700",
    bottom:
      "absolute top-0 left-1/2 -translate-y-full -translate-x-1/2 border-4 border-transparent border-b-neutral-900 dark:border-b-neutral-700",
  }[side];

  return (
    <span
      ref={ref}
      className={cn("group/tooltip block", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              "pointer-events-none fixed z-[9999] px-2 py-1 rounded-md text-xs font-medium max-w-xs break-words whitespace-normal",
              "bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100",
              "animate-in fade-in duration-150",
              transformClass,
            )}
          >
            <span className={arrowClass} />
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
