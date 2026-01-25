import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { BridgeContext } from './BridgeContext';
import type { BridgeServer } from './BridgeContext';
import * as opfs from '../lib/opfs';

interface BridgeProviderProps {
  children: ReactNode;
}

const STORAGE_FILE = 'bridge.json';

export function BridgeProvider({ children }: BridgeProviderProps) {
  const [servers, setServers] = useState<BridgeServer[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load servers from OPFS on mount
  useEffect(() => {
    const loadServers = async () => {
      try {
        const saved = await opfs.readJson<BridgeServer[]>(STORAGE_FILE);
        if (saved && Array.isArray(saved)) {
          setServers(saved);
        }
      } catch (error) {
        console.warn('Failed to load bridge servers:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    
    loadServers();
  }, []);

  // Save servers to OPFS when they change (after initial load)
  useEffect(() => {
    if (!isLoaded) return;
    
    const saveServers = async () => {
      try {
        await opfs.writeJson(STORAGE_FILE, servers);
      } catch (error) {
        console.warn('Failed to save bridge servers:', error);
      }
    };
    
    saveServers();
  }, [servers, isLoaded]);

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
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
}
