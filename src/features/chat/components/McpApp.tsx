import { Loader2, Maximize2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppFrame, type AppBridge } from "@mcp-ui/client";
import { buildHostContext, createAppBridge, type McpAppData } from "@/features/settings/lib/mcpAppSession";
import { isAbortError } from "@/shared/lib/errors";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useOverlayRect } from "@/shared/lib/useOverlayRect";
import type { ToolResultContent } from "@/shared/types/chat";
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
  const frameRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AppBridge | null>(null);
  const [frame, setFrame] = useState<{ data: McpAppData; bridge: AppBridge } | null>(null);
  const [sandboxUrl] = useState(() => new URL("/mcp-app-sandbox-proxy.html", window.location.origin));
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inlineHeight, setInlineHeight] = useState(0);
  const [bridgeReady, setBridgeReady] = useState(false);
  const { showAppDrawer, closeApp, showDrawer, activeAppKey, setActiveAppKey, drawerTarget } = useApp();
  const { setProviderEnabled, restoreToolUI } = useToolsContext();

  const providerId = toolResult.meta?.toolProvider as string;
  const resourceUri = toolResult.meta?.toolResource as string;
  const appKey = `${providerId}-${resourceUri}-${toolResult.id}`;
  const content = toolResult.content;

  const appDisplayModes = getAppDisplayModes(toolResult);
  const [bridgeDisplayModes, setBridgeDisplayModes] = useState<AppDisplayMode[] | null>(null);
  const effectiveDisplayModes = bridgeDisplayModes ?? appDisplayModes;
  const isInlineOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "inline";
  const isFullscreenOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "fullscreen";

  // The drawer owns fullscreen selection. Deriving it here avoids competing
  // app effects repeatedly claiming the same panel from one another.
  const isFullscreen = showAppDrawer && activeAppKey === appKey;
  const openInPanel = () => {
    setActiveAppKey(appKey);
    showDrawer();
  };
  const requestDisplayMode = useEffectEvent((mode: string) => {
    if (mode === "fullscreen") {
      // Older fullscreen-only apps initialize in the background.
      if (sessionRef.current || isLastFullscreenApp) openInPanel();
    } else if (activeAppKey === appKey) {
      void closeApp();
    }
  });

  // Fullscreen: track the drawer's content rect so the fixed iframe overlays it.
  const overlay = useOverlayRect(isFullscreen ? drawerTarget : null);

  const onSizeChange = useEffectEvent((height: number) => {
    if (!isFullscreen) setInlineHeight(Math.min(height, INLINE_MAX_HEIGHT));
  });

  const displayMode = isFullscreen || isFullscreenOnly ? "fullscreen" : "inline";
  const updateHostContext = useEffectEvent(() => {
    if (bridgeReady && sessionRef.current && frameRef.current && frame) {
      sessionRef.current.setHostContext(buildHostContext(frame.data.tool, frameRef.current, displayMode));
    }
  });
  const getDisplayMode = useEffectEvent(() => displayMode);
  const renderApp = useEffectEvent(async (signal: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const args = JSON.parse(toolResult.arguments || "{}");
      await setProviderEnabled(providerId, true);
      signal.throwIfAborted();
      const data = await restoreToolUI(providerId, toolResult.name, resourceUri, args, toolResult.result, content, {
        signal,
        initialResult: toolResult.meta?.mcpResult as import("@modelcontextprotocol/client").CallToolResult | undefined,
      });
      signal.throwIfAborted();
      const bridge = createAppBridge(data, {
        getDisplayMode,
        onDisplayModeRequested: requestDisplayMode,
        hostContext: frameRef.current ? buildHostContext(data.tool, frameRef.current, displayMode) : undefined,
      });
      const unsubscribe = data.subscribe((kind) => {
        if (kind === "disconnect") {
          sessionRef.current = null;
          setError("MCP server disconnected. Reopen this app to reconnect.");
          void bridge.close();
        } else if (bridge.getAppCapabilities()) {
          const notify =
            kind === "tools"
              ? bridge.sendToolListChanged()
              : kind === "resources"
                ? bridge.sendResourceListChanged()
                : bridge.sendPromptListChanged();
          void notify.catch(console.error);
        }
      });
      signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          void bridge
            .teardownResource({}, { timeout: 1000 })
            .catch(() => {})
            .finally(() => bridge.close());
        },
        { once: true },
      );
      sessionRef.current = bridge;
      setFrame({ data, bridge });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      setError(error instanceof Error ? error.message : "Could not open this app");
      setIsLoading(false);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    void renderApp(controller.signal);
    return () => {
      controller.abort();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!frame || !frameRef.current) return;
    const resize = new ResizeObserver(updateHostContext);
    const theme = new MutationObserver(updateHostContext);
    resize.observe(frameRef.current);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    updateHostContext();
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [frame]);

  useEffect(() => {
    if (bridgeReady && isFullscreenOnly && isLastFullscreenApp) {
      setActiveAppKey(appKey);
      showDrawer();
    }
  }, [bridgeReady, isFullscreenOnly, isLastFullscreenApp, appKey, setActiveAppKey, showDrawer]);

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
    updateHostContext();
  }, [bridgeReady, isFullscreen, isFullscreenOnly, overlayWidth]);

  const iframeStyle: CSSProperties =
    isFullscreen || isFullscreenOnly
      ? isFullscreen && overlay
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
      {isFullscreen || isFullscreenOnly ? (
        <button
          type="button"
          onClick={openInPanel}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors py-1.5 px-2 rounded-md bg-neutral-100 dark:bg-neutral-900/40"
        >
          <Maximize2 size={12} />
          <span>{showAppDrawer && activeAppKey === appKey ? "Showing in panel" : "Open in panel"}</span>
        </button>
      ) : (
        !isInlineOnly && (
          <div className="flex justify-end mb-1">
            <button type="button" onClick={openInPanel} className={actionButtonClassName} title="Expand to panel">
              <Maximize2 size={ACTION_ICON_SIZE} />
              <span>Open in panel</span>
            </button>
          </div>
        )
      )}

      {error && (
        <p role="alert" className="p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
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
        <div ref={frameRef} style={iframeStyle} className="[&_iframe]:!w-full [&_iframe]:!h-full">
          {frame && (
            <AppFrame
              appBridge={frame.bridge}
              html={frame.data.html}
              sandbox={{ url: sandboxUrl, permissions: "allow-scripts", csp: frame.data.resource.meta?.csp }}
              toolInput={frame.data.input}
              toolResult={frame.data.result}
              onInitialized={({ appCapabilities }) => {
                const modes = appCapabilities?.availableDisplayModes?.filter(
                  (mode): mode is AppDisplayMode => mode === "inline" || mode === "fullscreen",
                );
                if (modes?.length) {
                  setBridgeDisplayModes(modes);
                  if (!modes.includes(displayMode)) requestDisplayMode(modes[0]);
                }
                setIsLoading(false);
                setBridgeReady(true);
              }}
              onSizeChanged={({ height }) => {
                if (height && Number.isFinite(height)) onSizeChange(height);
              }}
              onError={(error) => {
                setError(error.message);
                setIsLoading(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
