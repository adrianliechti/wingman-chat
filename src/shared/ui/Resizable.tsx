"use client";

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/shared/lib/cn";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function handleResizeDragStart() {
  document.body.classList.add("resizing");
  const onUp = () => {
    // Defer removing the class by two rAF frames so the library can commit its
    // final layout update before the CSS transition is re-enabled. Without this,
    // fast drags that leave the handle trigger a brief catch-up animation.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.remove("resizing");
      });
    });
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function ResizableHandle({
  withHandle = true,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-1 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400 aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:w-full",
        className,
      )}
      onPointerDown={handleResizeDragStart}
      {...props}
    >
      {withHandle && (
        <div className="absolute z-10 bg-neutral-300 rounded-sm dark:bg-neutral-700 shadow-sm opacity-60">
          <div className="grid grid-cols-1 justify-items-center gap-0.5 px-0.5 py-1.5">
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
            <div className="h-px w-px rounded-full bg-neutral-600 dark:bg-neutral-400" />
          </div>
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
