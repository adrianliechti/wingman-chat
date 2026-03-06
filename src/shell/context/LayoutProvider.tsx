import { useState, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { LayoutContext } from './LayoutContext';
import type { LayoutMode, LayoutContextType } from './LayoutContext';

export function LayoutProvider({ children }: { children: ReactNode }) {
  // Initialize layout mode from localStorage
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'normal';
    
    const stored = localStorage.getItem('app_layout');
    return stored === 'wide' ? 'wide' : 'normal';
  });

  // Persist layout mode changes
  const handleSetLayoutMode = (mode: LayoutMode) => {
    setLayoutMode(mode);
    
    if (mode === 'normal') {
      localStorage.removeItem('app_layout');
    } else {
      localStorage.setItem('app_layout', mode);
    }
  };

  // Apply any layout-specific effects
  useLayoutEffect(() => {
    // Apply wide class when in wide mode (responsive/takes more space)
    document.documentElement.classList.toggle('layout-wide', layoutMode === 'wide');
  }, [layoutMode]);

  const value: LayoutContextType = {
    layoutMode,
    setLayoutMode: handleSetLayoutMode,
  };

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}
