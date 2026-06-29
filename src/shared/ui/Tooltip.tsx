import {
  arrow,
  autoUpdate,
  FloatingArrow,
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, className, side = "right" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
  });

  // Hover and keyboard focus both reveal the tooltip; Escape dismisses it via useRole.
  const hover = useHover(context, { move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, { duration: 150 });

  return (
    <>
      <span ref={refs.setReference} className={cn("group/tooltip block", className)} {...getReferenceProps()}>
        {children}
      </span>
      {isMounted && (
        <FloatingPortal>
          <span
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...transitionStyles }}
            className="pointer-events-none z-9999 px-2 py-1 rounded-md text-xs font-medium max-w-xs wrap-break-word whitespace-normal bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100"
            {...getFloatingProps()}
          >
            <FloatingArrow ref={arrowRef} context={context} className="fill-neutral-900 dark:fill-neutral-700" />
            {content}
          </span>
        </FloatingPortal>
      )}
    </>
  );
}
