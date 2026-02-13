import { useEffect, useRef } from 'react';
import { useApp } from '@/shell/hooks/useApp';

export function AppDrawer() {
  const { registerIframe } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Register the iframe with the context when it's available
  useEffect(() => {
    registerIframe(iframeRef.current);
  }, [registerIframe]);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md pt-2 md:pt-0">
      <iframe
        ref={iframeRef}
        className="w-full h-full border-none"
        title="App"
      />
    </div>
  );
}
