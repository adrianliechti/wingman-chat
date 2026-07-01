import { createContext } from "react";

export interface AppContextType {
  showAppDrawer: boolean;
  setShowAppDrawer: (show: boolean) => void;
  toggleAppDrawer: () => void;
  renderAppInto: (iframe: HTMLIFrameElement) => Promise<void>;
  closeApp: () => Promise<void>;
  hasAppContent: boolean;
  showDrawer: () => void;
  activeAppKey: string | null;
  setActiveAppKey: (key: string | null) => void;
  /** The drawer's content element — a fullscreen app's iframe overlays this rect. */
  drawerTarget: HTMLElement | null;
  registerDrawerTarget: (el: HTMLElement | null) => void;
}

export const AppContext = createContext<AppContextType | null>(null);
