import { createContext } from 'react';
import type { MCPClient } from '../lib/mcp';

export type BridgeContextType = {
  bridge?: MCPClient;
};

export const BridgeContext = createContext<BridgeContextType | undefined>(undefined);
