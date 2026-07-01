import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useSidebarResize } from "@/shell/hooks/useSidebarResize";
import type { SidebarContextType } from "./SidebarContext";
import { SidebarContext } from "./SidebarContext";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<ReactNode>(null);
  const {
    width: sidebarWidth,
    isResizing: isSidebarResizing,
    handleMouseDown: handleSidebarResizeMouseDown,
    resetWidth: resetSidebarWidth,
  } = useSidebarResize();

  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev);
  }, []);

  const value: SidebarContextType = {
    showSidebar,
    setShowSidebar,
    toggleSidebar,
    sidebarContent,
    setSidebarContent,
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeMouseDown,
    resetSidebarWidth,
  };

  return <SidebarContext value={value}>{children}</SidebarContext>;
}
