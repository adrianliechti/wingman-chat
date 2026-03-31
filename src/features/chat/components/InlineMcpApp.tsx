import { Loader2, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import type { ToolContext, ToolResultContent } from "@/shared/types/chat";
import { useApp } from "@/shell/hooks/useApp";

interface InlineMcpAppProps {
  toolResult: ToolResultContent;
  isLastFullscreenApp: boolean;
}

type AppDisplayMode = "inline" | "fullscreen";

function getAppDisplayModes(toolResult: ToolResultContent): AppDisplayMode[] {
  const modes = toolResult.meta?.appDisplayModes as AppDisplayMode[] | undefined;
  if (modes && modes.length > 0) return modes;
  // Fallback: use defaultDisplayMode as a hint when availableDisplayModes is not set
  const defaultMode = toolResult.meta?.defaultDisplayMode as string | undefined;
  if (defaultMode === "fullscreen") return ["fullscreen"];
  if (defaultMode === "inline") return ["inline"];
  // No info at all: assume both modes (backward compat)
  return ["inline", "fullscreen"];
}

export function InlineMcpApp({ toolResult, isLastFullscreenApp }: InlineMcpAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => Promise<void> | void) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { renderAppInto, renderApp, showDrawer, showAppDrawer, activeAppKey, setActiveAppKey } = useApp();
  const { setProviderEnabled, restoreToolUI } = useToolsContext();

  const providerId = toolResult.meta?.toolProvider as string;
  const resourceUri = toolResult.meta?.toolResource as string;
  const appKey = `${providerId}-${resourceUri}-${toolResult.id}`;

  const appDisplayModes = getAppDisplayModes(toolResult);
  const isInlineOnly = appDisplayModes.length === 1 && appDisplayModes[0] === "inline";
  const isFullscreenOnly = appDisplayModes.length === 1 && appDisplayModes[0] === "fullscreen";
  const supportsBoth = appDisplayModes.includes("inline") && appDisplayModes.includes("fullscreen");

  // Determine initial display mode
  const getInitialDisplayMode = (): AppDisplayMode => {
    if (isInlineOnly) return "inline";
    if (isFullscreenOnly) return "fullscreen";
    // Both modes: show fullscreen only if this is the last fullscreen app
    return isLastFullscreenApp ? "fullscreen" : "inline";
  };

  const [displayMode, setDisplayMode] = useState<AppDisplayMode>(getInitialDisplayMode);

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

    setDisplayMode("fullscreen");
    setActiveAppKey(appKey);

    try {
      const args = JSON.parse(toolResult.arguments || "{}");
      await setProviderEnabled(providerId, true);

      const context: ToolContext = {
        render: () => renderApp(),
      };

      await restoreToolUI(providerId, toolResult.name, resourceUri, args, toolResult.result, context, {
        displayMode: "fullscreen",
      });
    } catch (error) {
      console.error("Failed to expand to fullscreen:", error);
      if (!isFullscreenOnly) {
        setDisplayMode("inline");
      }
    }
  }, [
    toolResult,
    providerId,
    resourceUri,
    appKey,
    isFullscreenOnly,
    setProviderEnabled,
    renderApp,
    restoreToolUI,
    setActiveAppKey,
  ]);

  const renderInline = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setIsLoading(true);

    try {
      const args = JSON.parse(toolResult.arguments || "{}");
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
        displayMode: "inline",
      });

      setIsLoading(false);
    } catch (error) {
      console.error("Failed to render inline MCP app:", error);
      setIsLoading(false);
    }
  }, [toolResult, providerId, resourceUri, setProviderEnabled, renderAppInto, restoreToolUI]);

  // When drawer closes while in fullscreen mode:
  // - For "both" mode apps: switch to inline
  // - For fullscreen-only apps: stay in fullscreen mode (just show the reopen button)
  const [prevShowAppDrawer, setPrevShowAppDrawer] = useState(showAppDrawer);
  if (showAppDrawer !== prevShowAppDrawer) {
    setPrevShowAppDrawer(showAppDrawer);
    if (!showAppDrawer && displayMode === "fullscreen" && activeAppKey === appKey) {
      if (supportsBoth) {
        setDisplayMode("inline");
      }
      // For fullscreen-only: displayMode stays "fullscreen", will show the reopen button
    }
  }

  // When another app takes over fullscreen, switch this one to inline (if it supports it)
  const [prevActiveAppKey, setPrevActiveAppKey] = useState(activeAppKey);
  if (activeAppKey !== prevActiveAppKey) {
    setPrevActiveAppKey(activeAppKey);
    if (activeAppKey !== appKey && displayMode === "fullscreen" && !isFullscreenOnly) {
      setDisplayMode("inline");
    }
  }

  useEffect(() => {
    if (displayMode === "fullscreen" && !isFullscreenOnly) {
      expandToFullscreen();
    } else if (displayMode === "fullscreen" && isFullscreenOnly && isLastFullscreenApp) {
      expandToFullscreen();
    } else if (displayMode === "inline") {
      renderInline();
    }

    return () => {
      if (cleanupRef.current) {
        const cleanup = cleanupRef.current;
        cleanupRef.current = null;
        Promise.resolve(cleanup()).catch(console.error);
      }
    };
  }, [displayMode, isFullscreenOnly, isLastFullscreenApp, expandToFullscreen, renderInline]);

  // === FULLSCREEN-ONLY: always show a button to open/reopen in panel ===
  if (isFullscreenOnly) {
    return (
      <div className="mt-2 ml-5 mb-2">
        <button
          type="button"
          onClick={() => expandToFullscreen()}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors py-1.5 px-2 rounded bg-neutral-100 dark:bg-neutral-800/50"
        >
          <Maximize2 size={12} />
          <span>{showAppDrawer && activeAppKey === appKey ? "Showing in panel" : "Open in panel"}</span>
        </button>
      </div>
    );
  }

  // === BOTH MODES: fullscreen state shows "Showing in panel" button ===
  if (displayMode === "fullscreen" && supportsBoth) {
    return (
      <div className="mt-2 ml-5 mb-2">
        <button
          type="button"
          onClick={() => showDrawer()}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors py-1.5 px-2 rounded bg-neutral-100 dark:bg-neutral-800/50"
        >
          <Maximize2 size={12} />
          <span>Showing in panel</span>
        </button>
      </div>
    );
  }

  // === INLINE rendering (inline-only or both-modes in inline state) ===
  return (
    <div className="mt-2 ml-5 mb-2 relative rounded-lg overflow-hidden border border-neutral-200/60 dark:border-neutral-700/60 min-h-[60px]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-neutral-950/80 z-10 min-h-[60px]">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
        </div>
      )}
      {/* Only show expand button if the app supports fullscreen */}
      {supportsBoth && (
        <button
          type="button"
          onClick={expandToFullscreen}
          className="absolute top-2 right-2 z-20 flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-white/90 dark:bg-neutral-800/90 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 shadow-sm border border-neutral-200/60 dark:border-neutral-700/60 opacity-0 hover:opacity-100 focus:opacity-100 transition-all text-xs"
          title="Expand to panel"
        >
          <Maximize2 size={12} />
          <span>Open in panel</span>
        </button>
      )}
      <iframe
        ref={iframeRef}
        className="w-full border-none"
        style={{ height: 0 }}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={`MCP App: ${toolResult.name}`}
      />
    </div>
  );
}
