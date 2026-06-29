import type { ReactNode } from "react";
import { useCallback, useState } from "react";

import { AppContext } from "./AppContext";

interface AppProviderProps {
  children: ReactNode;
}

const SANDBOX_PROXY_PATH = "/mcp-app-sandbox-proxy.html";

export function AppProvider({ children }: AppProviderProps) {
  const [showAppDrawer, setShowAppDrawer] = useState(false);
  const [hasAppContent, setHasAppContent] = useState(false);
  const [activeAppKey, setActiveAppKey] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<HTMLElement | null>(null);
  const registerDrawerTarget = useCallback((el: HTMLElement | null) => setDrawerTarget(el), []);

  const toggleAppDrawer = useCallback(() => {
    setShowAppDrawer((prev) => !prev);
  }, []);

  // Load the sandbox proxy into the (caller-owned, persistent) iframe. The app's
  // bridge lives on this iframe and is cleaned up by the owning component (McpApp).
  const renderAppInto = useCallback(async (iframe: HTMLIFrameElement): Promise<void> => {
    const sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;

    await new Promise<void>((resolve, reject) => {
      const handleLoad = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Failed to load MCP app sandbox proxy."));
      };

      const cleanup = () => {
        iframe.removeEventListener("load", handleLoad);
        iframe.removeEventListener("error", handleError);
      };

      iframe.addEventListener("load", handleLoad);
      iframe.addEventListener("error", handleError);
      iframe.src = `${SANDBOX_PROXY_PATH}?session=${encodeURIComponent(sessionId)}`;
    });
  }, []);

  const closeApp = useCallback(async () => {
    setShowAppDrawer(false);
    setHasAppContent(false);
    setActiveAppKey(null);
  }, []);

  const showDrawer = useCallback(() => {
    setShowAppDrawer(true);
    setHasAppContent(true);
  }, []);

  const value = {
    showAppDrawer,
    setShowAppDrawer,
    toggleAppDrawer,
    renderAppInto,
    closeApp,
    hasAppContent,
    showDrawer,
    activeAppKey,
    setActiveAppKey,
    drawerTarget,
    registerDrawerTarget,
  };

  return <AppContext value={value}>{children}</AppContext>;
}
