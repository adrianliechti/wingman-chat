import { arrow, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
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
  const [visible, setVisible] = useState(false);
  const arrowRef = useRef<HTMLSpanElement>(null);

  const { refs, floatingStyles, middlewareData, placement } = useFloating({
    placement: side,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
  });

  const arrowSide = ({ top: "bottom", bottom: "top", left: "right", right: "left" } as const)[
    placement.split("-")[0] as "top" | "bottom" | "left" | "right"
  ];

  const arrowPositionStyle: React.CSSProperties =
    arrowSide === "left" || arrowSide === "right"
      ? { top: middlewareData.arrow?.y, [arrowSide]: -8 }
      : { left: middlewareData.arrow?.x, [arrowSide]: -8 };

  const arrowColorClass = {
    left: "border-r-neutral-900 dark:border-r-neutral-700",
    right: "border-l-neutral-900 dark:border-l-neutral-700",
    top: "border-b-neutral-900 dark:border-b-neutral-700",
    bottom: "border-t-neutral-900 dark:border-t-neutral-700",
  }[arrowSide];

  return (
    <span
      ref={refs.setReference}
      role="none"
      className={cn("group/tooltip block", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {createPortal(
        <span
          ref={refs.setFloating}
          role="tooltip"
          aria-hidden={!visible}
          style={{
            ...floatingStyles,
            opacity: visible ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
          className="pointer-events-none z-9999 px-2 py-1 rounded-md text-xs font-medium max-w-xs wrap-break-word whitespace-normal bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100"
        >
          <span
            ref={arrowRef}
            style={{ position: "absolute", ...arrowPositionStyle }}
            className={cn("border-4 border-transparent", arrowColorClass)}
          />
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}
