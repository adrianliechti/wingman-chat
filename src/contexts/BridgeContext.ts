import { createContext } from 'react';

export type BridgeServer = {
  id: string;
  name: string;
  description: string;
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
};

export interface BridgeContextType {
  servers: BridgeServer[];
  addServer: (server: Omit<BridgeServer, 'id'>) => BridgeServer;
  updateServer: (id: string, updates: Partial<Omit<BridgeServer, 'id'>>) => void;
  removeServer: (id: string) => void;
  toggleServer: (id: string) => void;
  getEnabledServers: () => BridgeServer[];
}

export const BridgeContext = createContext<BridgeContextType | undefined>(undefined);
