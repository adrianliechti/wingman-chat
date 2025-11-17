import { useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { getConfig } from '../config';
import { Bridge } from '../lib/bridge';
import { BridgeContext } from './BridgeContext';
import type { BridgeContextType } from './BridgeContext';

interface BridgeProviderProps {
  children: ReactNode;
}

export function BridgeProvider({ children }: BridgeProviderProps) {
  const config = getConfig();
  const bridge = useMemo(() => Bridge.create(config.bridge.url), [config.bridge.url]);

  // Cleanup bridge on unmount
  useEffect(() => {
    return () => {
      bridge.close();
    };
  }, [bridge]);

  const value: BridgeContextType = {
    bridge,
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}
