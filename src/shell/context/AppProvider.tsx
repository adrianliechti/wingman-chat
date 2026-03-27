import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";

import type { RenderedAppHandle } from "@/shared/types/chat";

import { AppContext } from "./AppContext";

interface AppProviderProps {
  children: ReactNode;
}

const SANDBOX_PROXY_PATH = "/mcp-app-sandbox-proxy.html";

export function AppProvider({ children }: AppProviderProps) {
  const [showAppDrawer, setShowAppDrawer] = useState(false);
  const [hasAppContent, setHasAppContent] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const activeCleanupRef = useRef<(() => Promise<void> | void) | null>(null);

  const runActiveCleanup = useCallback(async () => {
    const cleanup = activeCleanupRef.current;
    activeCleanupRef.current = null;

    if (!cleanup) {
      return;
    }

    try {
      await cleanup();
    } catch (error) {
      console.error("Failed to clean up active MCP app session:", error);
    }
  }, []);

  const toggleAppDrawer = useCallback(() => {
    setShowAppDrawer((prev) => !prev);
  }, []);

  const registerIframe = useCallback((iframe: HTMLIFrameElement | null) => {
    iframeRef.current = iframe;
  }, []);

  const getIframe = useCallback(() => {
    return iframeRef.current;
  }, []);

  const renderApp = useCallback(async (): Promise<RenderedAppHandle> => {
    const iframe = iframeRef.current;

    if (!iframe) {
      throw new Error("App drawer iframe not available. Make sure the drawer is mounted.");
    }

    await runActiveCleanup();

    setShowAppDrawer(true);
    setHasAppContent(true);

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

    return {
      iframe,
      registerCleanup: (cleanup) => {
        activeCleanupRef.current = cleanup;
      },
    };
  }, [runActiveCleanup]);

  const showDrawer = useCallback(() => {
    setShowAppDrawer(true);
    setHasAppContent(true);
  }, []);

  useEffect(() => {
    return () => {
      runActiveCleanup().catch(console.error);
    };
  }, [runActiveCleanup]);

  const value = {
    showAppDrawer,
    setShowAppDrawer,
    toggleAppDrawer,
    registerIframe,
    getIframe,
    renderApp,
    hasAppContent,
    showDrawer,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
