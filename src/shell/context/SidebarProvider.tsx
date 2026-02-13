import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { SidebarContext } from './SidebarContext';
import type { SidebarContextType } from './SidebarContext';

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<ReactNode>(null);

  const toggleSidebar = useCallback(() => {
    setShowSidebar(prev => !prev);
  }, []);

  const value: SidebarContextType = {
    showSidebar,
    setShowSidebar,
    toggleSidebar,
    sidebarContent,
    setSidebarContent,
  };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}
