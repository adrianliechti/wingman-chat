import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Tool, ToolProvider } from '../types/chat';
import { getConfig } from '../config';
import { BridgeContext } from './BridgeContext';
import type { BridgeContextType } from './BridgeContext';

interface BridgeProviderProps {
  children: ReactNode;
}

export function BridgeProvider({ children }: BridgeProviderProps) {
  const config = getConfig();
  const bridge = config.bridge;
  const [bridgeTools, setBridgeTools] = useState<Tool[]>([]);
  const [bridgeInstructions, setBridgeInstructions] = useState<string | null>(bridge.getInstructions());

  // Fetch bridge tools when bridge is connected
  useEffect(() => {
    const updateBridge = async () => {
      if (bridge.isConnected()) {
        try {
          const tools = await bridge.listTools();
          setBridgeTools(prev => {
            // Only update if tools have changed
            if (JSON.stringify(prev) !== JSON.stringify(tools)) {
              return tools;
            }
            return prev;
          });
        } catch (error) {
          console.error("Failed to fetch bridge tools:", error);
          setBridgeTools(prev => prev.length > 0 ? [] : prev);
        }
      } else {
        setBridgeTools(prev => prev.length > 0 ? [] : prev);
      }
      
      // Update instructions (can be available even when not connected)
      const instructions = bridge.getInstructions();
      setBridgeInstructions(prev => prev !== instructions ? instructions : prev);
    };

    updateBridge();
    
    const interval = setInterval(updateBridge, 5000);    
    return () => clearInterval(interval);
  }, [bridge]);

  const bridgeProvider = useCallback((): ToolProvider | null => {
    if (!bridge.isConnected() || bridgeTools.length === 0) {
      return null;
    }

    return {
      id: 'bridge',

      name: 'Bridge',
      description: 'Tools provided via the bridge connection',
      
      instructions: bridgeInstructions || undefined,
      
      tools: async () => bridgeTools,
    };
  }, [bridge, bridgeTools, bridgeInstructions]);

  const value: BridgeContextType = {
    isConnected: bridge.isConnected(),
    bridgeProvider,
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}
