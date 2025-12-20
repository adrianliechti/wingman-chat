import { createContext } from 'react';

export interface AppContextType {
  showAppDrawer: boolean;
  setShowAppDrawer: (show: boolean) => void;
  toggleAppDrawer: () => void;
  registerIframe: (iframe: HTMLIFrameElement | null) => void;
  getIframe: () => HTMLIFrameElement | null;
  hasAppContent: boolean;
  showDrawer: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);
