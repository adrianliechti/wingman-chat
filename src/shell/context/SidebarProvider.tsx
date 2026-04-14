import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import type { SidebarContextType } from "./SidebarContext";
import { SidebarContext } from "./SidebarContext";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<ReactNode>(null);

  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev);
  }, []);

  const value: SidebarContextType = {
    showSidebar,
    setShowSidebar,
    toggleSidebar,
    sidebarContent,
    setSidebarContent,
  };

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
