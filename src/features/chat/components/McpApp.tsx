import { Loader2, Maximize2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { parseToolArguments } from "@/shared/lib/toolArguments";
import { useOverlayRect } from "@/shared/lib/useOverlayRect";
import type { ToolContext, ToolResultContent } from "@/shared/types/chat";
import { ACTION_ICON_SIZE, actionButtonClassName } from "@/shared/ui/actionButton";
import { useApp } from "@/shell/hooks/useApp";

interface McpAppProps {
  toolResult: ToolResultContent;
  isLastFullscreenApp: boolean;
}

type AppDisplayMode = "inline" | "fullscreen";

const INLINE_MAX_HEIGHT = 600;

function getAppDisplayModes(toolResult: ToolResultContent): AppDisplayMode[] {
  const modes = toolResult.meta?.appDisplayModes as AppDisplayMode[] | undefined;
  if (modes && modes.length > 0) return modes;
  const defaultMode = toolResult.meta?.defaultDisplayMode as string | undefined;
  if (defaultMode === "fullscreen") return ["fullscreen"];
  if (defaultMode === "inline") return ["inline"];
  return ["inline", "fullscreen"];
}

/**
 * Renders an MCP UI app. The iframe is created ONCE and never reparented, so its
 * bridge (and app state, e.g. a streamed PDF) survives mode changes:
 *   - inline:     the iframe sits in flow inside the chat card.
 *   - fullscreen: the SAME iframe flips to `position: fixed` and overlays the
 *                 drawer's content rect (tracked via useOverlayRect).
 * Switching modes just repositions the iframe and pushes a host-context update
 * (setDisplayMode) — no teardown, no reload.
 */
export function McpApp({ toolResult, isLastFullscreenApp }: McpAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => Promise<void> | void) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inlineHeight, setInlineHeight] = useState(0);
  const [bridgeReady, setBridgeReady] = useState(false);
  const { renderAppInto, showAppDrawer, closeApp, showDrawer, activeAppKey, setActiveAppKey, drawerTarget } = useApp();
  const { setProviderEnabled, restoreToolUI, setDisplayMode: setBridgeDisplayMode } = useToolsContext();

  const providerId = toolResult.meta?.toolProvider as string;
  const resourceUri = toolResult.meta?.toolResource as string;
  const appKey = `${providerId}-${resourceUri}-${toolResult.id}`;
  const content = toolResult.content;

  const appDisplayModes = getAppDisplayModes(toolResult);
  const [bridgeDisplayModes, setBridgeDisplayModes] = useState<AppDisplayMode[] | null>(null);
  const effectiveDisplayModes = bridgeDisplayModes ?? appDisplayModes;
  const isInlineOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "inline";
  const isFullscreenOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "fullscreen";

  const getInitialDisplayMode = (): AppDisplayMode => {
    if (appDisplayModes.length === 1 && appDisplayModes[0] === "fullscreen" && isLastFullscreenApp) return "fullscreen";
    if (showAppDrawer && activeAppKey === appKey) return "fullscreen";
    return "inline";
  };

  const [displayMode, setDisplayMode] = useState<AppDisplayMode>(getInitialDisplayMode);
  const isFullscreen = displayMode === "fullscreen";

  // Fullscreen: track the drawer's content rect so the fixed iframe overlays it.
  const overlay = useOverlayRect(isFullscreen ? drawerTarget : null);

  // Used inside the (stable) bridge callbacks to read the latest mode.
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

  // Render the bridge once on mount. An Effect Event so it always reads the latest
  // props/state without forcing the mount Effect below to re-run — the bridge is
  // persistent across mode changes.
  const renderApp = useEffectEvent(async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setIsLoading(true);
    try {
      const args = parseToolArguments(toolResult.arguments);
      await setProviderEnabled(providerId, true);
      await renderAppInto(iframe);

      const context: ToolContext = {
        render: async () => ({
          iframe,
          registerCleanup: (cleanup) => {
            cleanupRef.current = cleanup;
          },
        }),
        updateMeta: (meta) => {
          const modes = meta.appDisplayModes as AppDisplayMode[] | undefined;
          if (modes && modes.length > 0) setBridgeDisplayModes(modes);
        },
      };

      await restoreToolUI(providerId, toolResult.name, resourceUri, args, toolResult.result, content, context, {
        displayMode: "inline",
        onDisplayModeRequested: (mode) => setDisplayMode(mode as AppDisplayMode),
        // Host owns the iframe height; only relevant inline (fullscreen fills the drawer).
        onSizeChange: (height) => {
          if (!isFullscreenRef.current) setInlineHeight(Math.min(height, INLINE_MAX_HEIGHT));
        },
      });

      setIsLoading(false);
      setBridgeReady(true);
    } catch (error) {
      console.error("Failed to render MCP app:", error);
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void renderApp();
    return () => {
      if (cleanupRef.current) {
        const cleanup = cleanupRef.current;
        cleanupRef.current = null;
        Promise.resolve(cleanup()).catch(console.error);
      }
    };
  }, []);

  // Open/close the drawer + claim active when the mode changes.
  useEffect(() => {
    if (!bridgeReady) return;
    if (isFullscreen) {
      setActiveAppKey(appKey);
      showDrawer(); // sets showAppDrawer + hasAppContent (nav toggle)
    } else if (activeAppKey === appKey) {
      // Back inline → fully release the drawer so the nav toggle disappears
      // (it's effectively a "close drawer" button; an empty drawer must not reopen).
      void closeApp();
    }
  }, [bridgeReady, isFullscreen, appKey, activeAppKey, setActiveAppKey, closeApp, showDrawer]);

  // Push the host-context (display mode + container dimensions) to the live bridge.
  // For fullscreen we wait until the iframe is positioned over the drawer so the
  // app reads the real drawer size (not the stale inline rect → "renders too small").
  // overlay.width/height as deps also re-push on drawer resize.
  // overlayWidth re-pushes host-context on drawer resize (host-context width is
  // the only container dimension fullscreen apps need; height is unbounded).
  const overlayWidth = overlay?.width;
  useEffect(() => {
    if (!bridgeReady) return;
    if (isFullscreen && overlayWidth === undefined) return;
    setBridgeDisplayMode(providerId, isFullscreen ? "fullscreen" : "inline");
  }, [bridgeReady, isFullscreen, overlayWidth, providerId, setBridgeDisplayMode]);

  // Closing the drawer (externally) returns this app inline.
  const [prevShowAppDrawer, setPrevShowAppDrawer] = useState(showAppDrawer);
  if (showAppDrawer !== prevShowAppDrawer) {
    setPrevShowAppDrawer(showAppDrawer);
    if (!showAppDrawer && isFullscreen && activeAppKey === appKey && !isFullscreenOnly) {
      setDisplayMode("inline");
    }
  }

  // Another app taking over the drawer drops this one out of fullscreen.
  const [prevActiveAppKey, setPrevActiveAppKey] = useState(activeAppKey);
  if (activeAppKey !== prevActiveAppKey) {
    setPrevActiveAppKey(activeAppKey);
    if (activeAppKey !== appKey && isFullscreen && !isFullscreenOnly) {
      setDisplayMode("inline");
    }
  }

  const iframeStyle: CSSProperties = isFullscreen
    ? overlay
      ? {
          position: "fixed",
          top: overlay.top,
          left: overlay.left,
          width: overlay.width,
          height: overlay.height,
          zIndex: 21,
          border: "none",
        }
      : { position: "fixed", width: 0, height: 0, opacity: 0, pointerEvents: "none", border: "none" }
    : { width: "100%", height: inlineHeight || 0, border: "none" };

  return (
    <div className="mt-2 mb-2">
      {isFullscreen ? (
        <button
          type="button"
          onClick={() => showDrawer()}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors py-1.5 px-2 rounded-md bg-neutral-100 dark:bg-neutral-900/40"
        >
          <Maximize2 size={12} />
          <span>{showAppDrawer && activeAppKey === appKey ? "Showing in panel" : "Open in panel"}</span>
        </button>
      ) : (
        !isInlineOnly && (
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={() => setDisplayMode("fullscreen")}
              className={actionButtonClassName}
              title="Expand to panel"
            >
              <Maximize2 size={ACTION_ICON_SIZE} />
              <span>Open in panel</span>
            </button>
          </div>
        )
      )}

      {/* Stable wrapper — the iframe never changes DOM parent, so the bridge survives.
          When fullscreen the iframe is position:fixed over the drawer, so this collapses. */}
      <div
        className={
          isFullscreen ? "" : "relative rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-900/40 min-h-[60px]"
        }
      >
        {isLoading && !isFullscreen && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-neutral-950/80 z-10 min-h-[60px]">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          style={iframeStyle}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={`MCP App: ${toolResult.name}`}
        />
      </div>
    </div>
  );
}
