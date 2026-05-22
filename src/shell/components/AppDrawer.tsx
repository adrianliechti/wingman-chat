import { useEffect, useLayoutEffect, useRef } from "react";
import { fitIframeToContainer } from "@/shared/lib/iframeResizer";
import { useApp } from "@/shell/hooks/useApp";

export function AppDrawer() {
  const { registerIframe } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect ensures the iframe is registered before any useEffect fires.
  // Cleanup deregisters it on unmount so the context never holds a stale ref.
  useLayoutEffect(() => {
    registerIframe(iframeRef.current);
    return () => registerIframe(null);
  }, [registerIframe]);

  // Keep the iframe sized to fill the available container space
  useEffect(() => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) return;
    return fitIframeToContainer(iframe, container);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-neutral-50 dark:bg-neutral-950">
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        <iframe
          ref={iframeRef}
          className="border-none"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title="App"
        />
      </div>
    </div>
  );
}
