import { useEffect, useState, useRef } from 'react';
import { getConfig } from '../config';
import { MCPClient } from '../lib/mcp';
import type { ToolProvider } from '../types/chat';

interface BridgeConfig {
  name: string;
  instructions?: string;
}

export function useBridgeProvider(): ToolProvider | null {
  const config = getConfig();
  const [bridge, setBridge] = useState<MCPClient | null>(null);
  const clientRef = useRef<MCPClient | null>(null);
  
  useEffect(() => {
    if (!config.bridge) {
      return;
    }

    let mounted = true;
    const baseUrl = config.bridge.url;

    (async () => {
      try {
        const response = await fetch(new URL('/.well-known/wingman', baseUrl));

        if (!response.ok) {
          console.info('Bridge unavailable');
          return;
        }

        const bridgeConfig: BridgeConfig = await response.json();
        console.log('Bridge config', bridgeConfig);

        const url = new URL('/mcp', baseUrl).toString();
        const client = new MCPClient(
          'bridge',
          url,
          'Bridge',
          'Local Developer tools'
        );

        await client.connect();
        console.info('Bridge connected');
        
        if (mounted) {
          clientRef.current = client;
          setBridge(client);
        } else {
          // Component unmounted during connection, clean up
          client.disconnect();
        }
      } catch (e) {
        console.warn('Bridge connection failed', e);
        if (mounted) {
          clientRef.current = null;
          setBridge(null);
        }
      }
    })();

    return () => {
      mounted = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [config.bridge, config.bridge?.url]);

  // Return null if bridge is disabled, otherwise return the connected bridge
  return config.bridge ? bridge : null;
}
