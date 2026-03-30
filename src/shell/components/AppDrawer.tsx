import { useEffect, useRef } from "react";
import { fitIframeToContainer } from "@/shared/lib/iframeResizer";
import { useApp } from "@/shell/hooks/useApp";

export function AppDrawer() {
  const { registerIframe } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Register the iframe with the context when it's available
  useEffect(() => {
    registerIframe(iframeRef.current);
  }, [registerIframe]);

  // Keep the iframe sized to fill the available container space
  useEffect(() => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) return;
    return fitIframeToContainer(iframe, container);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md">
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
