import type { ReactNode } from 'react';
import { BridgeContext } from './BridgeContext';
import type { BridgeServer } from './BridgeContext';
import { usePersistedState } from '../hooks/usePersistedState';

interface BridgeProviderProps {
  children: ReactNode;
}

export function BridgeProvider({ children }: BridgeProviderProps) {
  const { value: servers, setValue: setServers, isLoaded } = usePersistedState<BridgeServer[]>({
    key: 'bridge.json',
    defaultValue: [],
  });

  const addServer = (serverData: Omit<BridgeServer, 'id'>): BridgeServer => {
    const newServer: BridgeServer = {
      ...serverData,
      id: crypto.randomUUID(),
    };
    setServers(prev => [...prev, newServer]);
    return newServer;
  };

  const updateServer = (id: string, updates: Partial<Omit<BridgeServer, 'id'>>) => {
    setServers(prev => 
      prev.map(server => 
        server.id === id ? { ...server, ...updates } : server
      )
    );
  };

  const removeServer = (id: string) => {
    setServers(prev => prev.filter(server => server.id !== id));
  };

  const toggleServer = (id: string) => {
    setServers(prev => 
      prev.map(server => 
        server.id === id ? { ...server, enabled: !server.enabled } : server
      )
    );
  };

  const getEnabledServers = (): BridgeServer[] => {
    return servers.filter(server => server.enabled);
  };

  return (
    <BridgeContext.Provider
      value={{
        servers,
        addServer,
        updateServer,
        removeServer,
        toggleServer,
        getEnabledServers,
        isLoaded,
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
}
