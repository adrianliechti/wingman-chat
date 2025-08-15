import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Tool } from '../types/chat';
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
          setBridgeTools(tools);
        } catch (error) {
          console.error("Failed to fetch bridge tools:", error);
          setBridgeTools([]);
        }
      } else {
        setBridgeTools([]);
      }
      
      // Update instructions (can be available even when not connected)
      const instructions = bridge.getInstructions();
      setBridgeInstructions(instructions);
    };

    updateBridge();
    
    const interval = setInterval(updateBridge, 5000);    
    return () => clearInterval(interval);
  }, [bridge]);

  const value: BridgeContextType = {
    isConnected: bridge.isConnected(),
    bridgeTools,
    bridgeInstructions,
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}
