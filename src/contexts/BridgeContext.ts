import { createContext } from 'react';
import type { Tool } from '../types/chat';

export type BridgeContextType = {
  isConnected: boolean;
  bridgeTools: Tool[];
  bridgeInstructions: string | null;
};

export const BridgeContext = createContext<BridgeContextType | undefined>(undefined);
