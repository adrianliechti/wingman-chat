import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getConfig } from '../config';
import { MCPClient } from '../lib/mcp';
import { BridgeContext } from './BridgeContext';
import type { BridgeContextType } from './BridgeContext';

interface BridgeConfig {
  name: string;
  instructions?: string;
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const config = getConfig();
  const [bridge, setBridge] = useState<MCPClient | undefined>();
  
  useEffect(() => {
    if (!config.bridge?.enabled) {
      return;
    }

    const baseUrl = config.bridge.url;
    const url = new URL('/mcp', baseUrl).toString();
    const newBridge = new MCPClient('bridge', url, 'Bridge', 'Local connected tools');

    (async () => {
      try {
        const response = await fetch(new URL('/.well-known/wingman', baseUrl));

        if (!response.ok) {
          console.info('Bridge unavailable');
          return;
        }

        const bridgeConfig: BridgeConfig = await response.json();
        console.log('Bridge config', bridgeConfig);

        await newBridge.connect();
        console.info('Bridge connected');
        
        setBridge(newBridge);
      } catch (e) {
        console.warn('Bridge connection failed', e);
      }
    })();

    return () => {
      newBridge.disconnect();
    };
  }, [config.bridge?.enabled, config.bridge?.url]);

  const value: BridgeContextType = {
    bridge,
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}
