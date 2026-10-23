import { createContext } from "react";

export interface ActiveApp {
  key: string;
  title: string;
}

export interface AppContextType {
  showAppDrawer: boolean;
  setShowAppDrawer: (show: boolean) => void;
  toggleAppDrawer: () => void;
  closeApp: () => Promise<void>;
  hasAppContent: boolean;
  showDrawer: () => void;
  /** The app that owns the panel (or owned it last); its title names the edge tab. */
  activeApp: ActiveApp | null;
  setActiveApp: (app: ActiveApp | null) => void;
  /** The drawer's content element — a fullscreen app's iframe overlays this rect. */
  drawerTarget: HTMLElement | null;
  registerDrawerTarget: (el: HTMLElement | null) => void;
}

export const AppContext = createContext<AppContextType | null>(null);
