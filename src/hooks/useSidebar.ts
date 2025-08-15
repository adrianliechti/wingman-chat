import { useContext } from 'react';
import { SidebarContext } from '../contexts/SidebarContext';
import type { SidebarContextType } from '../contexts/SidebarContext';

export function useSidebar(): SidebarContextType {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
