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
import { type ReactNode, useState } from "react";
import { cn } from "@/shared/lib/cn";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, className, side = "right" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [arrowElement, setArrowElement] = useState<SVGSVGElement | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowElement })],
  });

  // Hover and keyboard focus both reveal the tooltip; Escape dismisses it via useRole.
  const hover = useHover(context, { move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role]);

  const setReference = (node: Element | null) => refs.setReference(node);
  const setFloating = (node: HTMLElement | null) => refs.setFloating(node);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, { duration: 150 });

  return (
    <>
      <span ref={setReference} className={cn("group/tooltip block", className)} {...getReferenceProps()}>
        {children}
      </span>
      {isMounted && (
        <FloatingPortal>
          <span
            ref={setFloating}
            style={{ ...floatingStyles, ...transitionStyles }}
            className="pointer-events-none z-9999 px-2 py-1 rounded-md text-xs font-medium max-w-xs wrap-break-word whitespace-normal bg-neutral-900 text-white dark:bg-neutral-700 dark:text-neutral-100"
            {...getFloatingProps()}
          >
            <FloatingArrow ref={setArrowElement} context={context} className="fill-neutral-900 dark:fill-neutral-700" />
            {content}
          </span>
        </FloatingPortal>
      )}
    </>
  );
}
