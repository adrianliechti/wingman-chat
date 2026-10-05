import { AppWindow, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppFrame, type AppBridge } from "@mcp-ui/client";
import { buildHostContext, createAppBridge, type McpAppData } from "@/features/settings/lib/mcpAppSession";
import { isAbortError } from "@/shared/lib/errors";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useOverlayRect } from "@/shared/lib/useOverlayRect";
import type { ToolCallPart, ToolResultPart } from "@tanstack/ai";
import { toolResultContent, toolResultMetadata } from "@/shared/lib/messages";
import { findTool } from "./toolDisplay";
import { cn } from "@/shared/lib/cn";
import { ACTION_ICON_SIZE, actionButtonClassName } from "@/shared/ui/actionButton";
import { getToolDisplayName } from "@/shared/lib/utils";
import { useApp } from "@/shell/hooks/useApp";

interface McpAppProps {
  call: ToolCallPart;
  result: ToolResultPart;
  isLastFullscreenApp: boolean;
}

type AppDisplayMode = "inline" | "fullscreen";

const INLINE_MAX_HEIGHT = 600;

function getAppDisplayModes(meta: Record<string, unknown> | undefined): AppDisplayMode[] {
  const modes = meta?.appDisplayModes as AppDisplayMode[] | undefined;
  if (modes && modes.length > 0) return modes;
  const defaultMode = meta?.defaultDisplayMode as string | undefined;
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
export function McpApp({ call, result, isLastFullscreenApp }: McpAppProps) {
  const data = toolResultMetadata(result);
  const frameRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AppBridge | null>(null);
  const [frame, setFrame] = useState<{ data: McpAppData; bridge: AppBridge } | null>(null);
  const [sandboxUrl] = useState(() => new URL("/mcp-app-sandbox-proxy.html", window.location.origin));
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inlineHeight, setInlineHeight] = useState(0);
  const [bridgeReady, setBridgeReady] = useState(false);
  const { showAppDrawer, toggleAppDrawer, closeApp, showDrawer, activeApp, setActiveApp, drawerTarget } = useApp();
  const activeAppKey = activeApp?.key ?? null;
  const { providers, setProviderEnabled, restoreToolUI } = useToolsContext();

  const providerId = data.meta?.toolProvider as string;
  const resourceUri = data.meta?.toolResource as string;
  const appKey = `${providerId}-${resourceUri}-${call.id}`;
  const content = data.content;

  const appDisplayModes = getAppDisplayModes(data.meta);
  const [bridgeDisplayModes, setBridgeDisplayModes] = useState<AppDisplayMode[] | null>(null);
  const effectiveDisplayModes = bridgeDisplayModes ?? appDisplayModes;
  const isInlineOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "inline";
  const isFullscreenOnly = effectiveDisplayModes.length === 1 && effectiveDisplayModes[0] === "fullscreen";

  // The drawer owns fullscreen selection. Deriving it here avoids competing
  // app effects repeatedly claiming the same panel from one another.
  const isFullscreen = showAppDrawer && activeAppKey === appKey;
  const otherAppInPanel = showAppDrawer && activeAppKey !== null && activeAppKey !== appKey;
  // Same name the tool row shows; it also labels the edge tab, so it must not change once loaded.
  const toolTitle = findTool(providers, call.name)?.title;
  const appTitle = toolTitle ?? getToolDisplayName(call.name);
  const openInPanel = () => {
    setActiveApp({ key: appKey, title: appTitle });
    showDrawer();
  };
  // What the chat card does when clicked, given where the app currently lives.
  const panelAction = !isFullscreen
    ? { label: otherAppInPanel ? "Switch to this app" : "Open in panel", Icon: PanelRightOpen, run: openInPanel }
    : isFullscreenOnly
      ? { label: "Close panel", Icon: PanelRightClose, run: toggleAppDrawer }
      : { label: "Show inline", Icon: Minimize2, run: () => void closeApp() };
  const panelStatus = isFullscreen ? "Showing in panel" : isLoading && !error ? "Loading app…" : panelAction.label;
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
      const args = JSON.parse(call.arguments || "{}");
      await setProviderEnabled(providerId, true);
      signal.throwIfAborted();
      const app = await restoreToolUI(providerId, call.name, resourceUri, args, toolResultContent(result), content, {
        signal,
        initialResult: data.meta?.mcpResult as import("@modelcontextprotocol/client").CallToolResult | undefined,
      });
      signal.throwIfAborted();
      const bridge = createAppBridge(app, {
        getDisplayMode,
        onDisplayModeRequested: requestDisplayMode,
        hostContext: frameRef.current ? buildHostContext(app.tool, frameRef.current, displayMode) : undefined,
      });
      const unsubscribe = app.subscribe((kind) => {
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
      setFrame({ data: app, bridge });
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
      setActiveApp({ key: appKey, title: appTitle });
      showDrawer();
    }
  }, [bridgeReady, isFullscreenOnly, isLastFullscreenApp, appKey, appTitle, setActiveApp, showDrawer]);

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
        // The app lives in the panel, so the chat keeps a card (same design as skill and
        // artifact chips) that reflects where it is right now and toggles it.
        <button
          type="button"
          onClick={panelAction.run}
          title={panelAction.label}
          aria-label={`${panelAction.label}: ${appTitle}`}
          className={cn(
            "group/app inline-flex w-72 max-w-full items-center gap-3 rounded-lg border px-3 py-2 text-left align-top transition-colors",
            isFullscreen
              ? "border-neutral-300 bg-neutral-100 hover:bg-neutral-200/70 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700/60"
              : "border-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60",
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
            {isLoading && !error ? (
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400 dark:text-neutral-500" />
            ) : (
              <AppWindow className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {appTitle}
            </span>
            <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">{panelStatus}</span>
          </span>
          <span
            className={cn(
              "shrink-0 text-neutral-400 transition-opacity dark:text-neutral-500",
              !isFullscreen && "opacity-0 group-hover/app:opacity-100",
            )}
          >
            <panelAction.Icon className="h-4 w-4" />
          </span>
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
          isFullscreen || isFullscreenOnly
            ? ""
            : "relative rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-900/40 min-h-[60px]"
        }
      >
        {isLoading && !isFullscreen && !isFullscreenOnly && (
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
