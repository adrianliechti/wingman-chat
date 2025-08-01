import { useState, useCallback, ReactNode, useEffect } from 'react';
import { RemoteUIContext, RemoteUIContextType } from './RemoteUIContext';
import { UIResource } from '../hooks/useRemoteUI';

interface RemoteUIProviderProps {
  children: ReactNode;
}

export function RemoteUIProvider({ children }: RemoteUIProviderProps) {
  const [showRemoteUIDrawer, setShowRemoteUIDrawer] = useState(false);
  const [resource, setResource] = useState<UIResource | null>(null);

  // Auto-hide drawer when no resource remains
  useEffect(() => {
    if (!resource && showRemoteUIDrawer) {
      setShowRemoteUIDrawer(false);
    }
  }, [resource, showRemoteUIDrawer]);

  const toggleRemoteUIDrawer = useCallback(() => {
    setShowRemoteUIDrawer(prev => !prev);
  }, []);

  const value: RemoteUIContextType = {
    showRemoteUIDrawer,
    setShowRemoteUIDrawer,
    toggleRemoteUIDrawer,
    resource,
    setResource,
  };

  return (
    <RemoteUIContext.Provider value={value}>
      {children}
    </RemoteUIContext.Provider>
  );
}
