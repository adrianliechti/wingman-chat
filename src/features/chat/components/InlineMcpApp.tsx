import { useRef, useState, useEffect, useCallback } from 'react';
import { Maximize2, Loader2 } from 'lucide-react';
import type { ToolResultContent, ToolContext } from '@/shared/types/chat';
import { useApp } from '@/shell/hooks/useApp';
import { useToolsContext } from '@/features/tools/hooks/useToolsContext';

interface InlineMcpAppProps {
  toolResult: ToolResultContent;
}

export function InlineMcpApp({ toolResult }: InlineMcpAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => Promise<void> | void) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<'inline' | 'fullscreen'>('inline');
  const [fullscreenOnly, setFullscreenOnly] = useState(false);
  const { renderAppInto, renderApp, showDrawer, showAppDrawer } = useApp();
  const { setProviderEnabled, restoreToolUI } = useToolsContext();

  const providerId = toolResult.meta?.toolProvider as string;
  const resourceUri = toolResult.meta?.toolResource as string;

  const expandToFullscreen = useCallback(async () => {
    // Cleanup inline bridge first
    if (cleanupRef.current) {
      try {
        await cleanupRef.current();
      } catch {
        // ignore
      }
      cleanupRef.current = null;
    }

    setDisplayMode('fullscreen');

    try {
      const args = JSON.parse(toolResult.arguments || '{}');
      await setProviderEnabled(providerId, true);

      const context: ToolContext = {
        render: () => renderApp(),
      };

      await restoreToolUI(providerId, toolResult.name, resourceUri, args, toolResult.result, context, {
        displayMode: 'fullscreen',
      });
    } catch (error) {
      console.error('Failed to expand to fullscreen:', error);
      setDisplayMode('inline');
    }
  }, [toolResult, providerId, resourceUri, setProviderEnabled, renderApp, restoreToolUI]);

  const renderInline = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setIsLoading(true);

    try {
      const args = JSON.parse(toolResult.arguments || '{}');
      await setProviderEnabled(providerId, true);

      await renderAppInto(iframe);

      const context: ToolContext = {
        render: async () => ({
          iframe,
          registerCleanup: (cleanup) => {
            cleanupRef.current = cleanup;
          },
        }),
      };

      await restoreToolUI(providerId, toolResult.name, resourceUri, args, toolResult.result, context, {
        displayMode: 'inline',
        onDisplayModeRequested: (mode) => {
          if (mode === 'fullscreen') {
            setFullscreenOnly(true);
            expandToFullscreen();
          }
        },
      });

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to render inline MCP app:', error);
      setIsLoading(false);
    }
  }, [toolResult, providerId, resourceUri, setProviderEnabled, renderAppInto, restoreToolUI, expandToFullscreen]);

  // When drawer closes while in fullscreen mode, switch back to inline
  // (React-recommended "adjust state during render" pattern)
  const [prevShowAppDrawer, setPrevShowAppDrawer] = useState(showAppDrawer);
  if (showAppDrawer !== prevShowAppDrawer) {
    setPrevShowAppDrawer(showAppDrawer);
    if (!showAppDrawer && displayMode === 'fullscreen') {
      setDisplayMode('inline');
    }
  }

  useEffect(() => {
    if (displayMode === 'inline' && !fullscreenOnly) {
      renderInline();
    }

    return () => {
      if (cleanupRef.current) {
        const cleanup = cleanupRef.current;
        cleanupRef.current = null;
        Promise.resolve(cleanup()).catch(console.error);
      }
    };
  }, [displayMode, fullscreenOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  if (displayMode === 'fullscreen' || fullscreenOnly) {
    return (
      <div className="mt-2 ml-5 mb-2">
        <button
          onClick={displayMode === 'fullscreen' ? () => showDrawer() : expandToFullscreen}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors py-1.5 px-2 rounded bg-neutral-100 dark:bg-neutral-800/50"
        >
          <Maximize2 size={12} />
          <span>{displayMode === 'fullscreen' ? 'Showing in panel' : 'Open in panel'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 ml-5 mb-2 relative rounded-lg overflow-hidden border border-neutral-200/60 dark:border-neutral-700/60">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-neutral-950/80 z-10">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
        </div>
      )}
      <button
        type="button"
        onClick={expandToFullscreen}
        className="absolute top-2 right-2 z-20 p-1.5 rounded bg-white/90 dark:bg-neutral-800/90 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 shadow-sm border border-neutral-200/60 dark:border-neutral-700/60 transition-colors"
        title="Expand to panel"
      >
        <Maximize2 size={14} />
      </button>
      <iframe
        ref={iframeRef}
        className="w-full border-none"
        // style={{ height: '400px', maxHeight: '400px' }}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={`MCP App: ${toolResult.name}`}
      />
    </div>
  );
}
