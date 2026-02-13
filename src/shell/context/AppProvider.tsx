import { useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { AppContext } from './AppContext';

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [showAppDrawer, setShowAppDrawer] = useState(false);
  const [hasAppContent, setHasAppContent] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const toggleAppDrawer = useCallback(() => {
    setShowAppDrawer(prev => !prev);
  }, []);

  const registerIframe = useCallback((iframe: HTMLIFrameElement | null) => {
    iframeRef.current = iframe;
  }, []);

  const getIframe = useCallback(() => {
    return iframeRef.current;
  }, []);

  const showDrawer = useCallback(() => {
    setShowAppDrawer(true);
    setHasAppContent(true);
  }, []);

  const value = {
    showAppDrawer,
    setShowAppDrawer,
    toggleAppDrawer,
    registerIframe,
    getIframe,
    hasAppContent,
    showDrawer,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
