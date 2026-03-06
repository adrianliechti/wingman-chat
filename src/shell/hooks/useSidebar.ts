import { useContext } from 'react';
import { SidebarContext } from '@/shell/context/SidebarContext';
import type { SidebarContextType } from '@/shell/context/SidebarContext';

export function useSidebar(): SidebarContextType {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
