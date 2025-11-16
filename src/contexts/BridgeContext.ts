import { createContext } from 'react';
import type { ToolProvider } from '../types/chat';

export type BridgeContextType = {
  isConnected: boolean;
  bridgeProvider: () => ToolProvider | null;
};

export const BridgeContext = createContext<BridgeContextType | undefined>(undefined);
