import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useApp } from "@/shell/hooks/useApp";

export function AppDrawer() {
  const { registerIframe, closeApp } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Register the iframe with the context when it's available
  useEffect(() => {
    registerIframe(iframeRef.current);
  }, [registerIframe]);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md">
      <div className="flex items-center justify-end px-2 py-1.5 shrink-0">
        <button
          type="button"
          onClick={closeApp}
          className="p-1 rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>
      <iframe
        ref={iframeRef}
        className="w-full flex-1 border-none"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="App"
      />
    </div>
  );
}
