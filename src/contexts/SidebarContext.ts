import { createContext } from 'react';
import type { ReactNode } from 'react';

export type SidebarContextType = {
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
  toggleSidebar: () => void;
  sidebarContent: ReactNode;
  setSidebarContent: (content: ReactNode) => void;
};

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);
