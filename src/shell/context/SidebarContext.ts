import type { ReactNode } from "react";
import { createContext } from "react";

export type SidebarContextType = {
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
  toggleSidebar: () => void;
  sidebarContent: ReactNode;
  setSidebarContent: (content: ReactNode) => void;
  /** Current sidebar width in px (desktop). Shared so fixed-position elements
   * (e.g. the chat input footer) can offset by it as the sidebar is resized. */
  sidebarWidth: number;
  isSidebarResizing: boolean;
  handleSidebarResizeMouseDown: (e: React.MouseEvent) => void;
  resetSidebarWidth: () => void;
};

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);
