import { useLayoutEffect, useRef } from "react";
import { useApp } from "@/shell/hooks/useApp";

/**
 * The app drawer is now just a positioning target: a fullscreen MCP app keeps its
 * own persistent iframe (in McpApp) and overlays this element's rect, rather
 * than reloading into a drawer-owned iframe.
 */
export function AppDrawer() {
  const { registerDrawerTarget } = useApp();
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registerDrawerTarget(rootRef.current);
    return () => registerDrawerTarget(null);
  }, [registerDrawerTarget]);

  return (
    <div ref={rootRef} className="h-full w-full bg-neutral-50 dark:bg-neutral-950 animate-in fade-in duration-200" />
  );
}
