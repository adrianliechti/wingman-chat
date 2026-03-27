import { createContext } from "react";

import type { RenderedAppHandle } from "@/shared/types/chat";

export interface AppContextType {
  showAppDrawer: boolean;
  setShowAppDrawer: (show: boolean) => void;
  toggleAppDrawer: () => void;
  registerIframe: (iframe: HTMLIFrameElement | null) => void;
  getIframe: () => HTMLIFrameElement | null;
  renderApp: () => Promise<RenderedAppHandle>;
  renderAppInto: (iframe: HTMLIFrameElement) => Promise<RenderedAppHandle>;
  closeApp: () => Promise<void>;
  hasAppContent: boolean;
  showDrawer: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);
