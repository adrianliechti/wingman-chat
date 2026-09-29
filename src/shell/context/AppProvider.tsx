import type { ReactNode } from "react";
import { useCallback, useState } from "react";

import { AppContext } from "./AppContext";

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [showAppDrawer, setShowAppDrawer] = useState(false);
  const [hasAppContent, setHasAppContent] = useState(false);
  const [activeAppKey, setActiveAppKey] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<HTMLElement | null>(null);
  const registerDrawerTarget = useCallback((el: HTMLElement | null) => setDrawerTarget(el), []);

  const toggleAppDrawer = useCallback(() => {
    setShowAppDrawer((prev) => !prev);
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
