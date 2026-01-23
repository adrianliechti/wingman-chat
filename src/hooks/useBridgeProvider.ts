import { useState, useEffect, useRef, useMemo } from 'react';
import { MCPClient } from '../lib/mcp';
import { useBridge } from './useBridge';
import type { ToolProvider } from '../types/chat';

/**
 * Bridge provider hook - creates MCP clients from user-configured bridge servers.
 * Returns an array of ToolProviders (MCPClients) for enabled bridge servers.
 */
export function useBridgeProvider(): ToolProvider[] {
  const { getEnabledServers } = useBridge();
  
  // Get enabled user servers
  const enabledServers = useMemo(() => getEnabledServers(), [getEnabledServers]);
  
  // Create MCP clients for enabled servers
  const [mcpClients, setMcpClients] = useState<MCPClient[]>(() => 
    enabledServers.map(server => new MCPClient(server.id, server.url, server.name, server.description, server.headers))
  );
  const clientsRef = useRef<MCPClient[]>(mcpClients);

  // Update MCP clients when enabledServers changes
  useEffect(() => {
    const currentIds = new Set(clientsRef.current.map(c => c.id));
    const newIds = new Set(enabledServers.map(s => s.id));
    
    // Check if we need to update
    const needsUpdate = 
      currentIds.size !== newIds.size ||
      enabledServers.some(s => !currentIds.has(s.id)) ||
      clientsRef.current.some(c => !newIds.has(c.id));
    
    if (needsUpdate) {
      // Disconnect removed clients
      const removedClients = clientsRef.current.filter(c => !newIds.has(c.id));
      removedClients.forEach(client => {
        client.disconnect().catch(console.error);
      });
      
      // Create new clients array, reusing existing connected clients
      const newClients = enabledServers.map(server => {
        const existing = clientsRef.current.find(c => c.id === server.id);
        if (existing) {
          return existing;
        }
        return new MCPClient(server.id, server.url, server.name, server.description, server.headers);
      });
      
      clientsRef.current = newClients;
      setMcpClients(newClients);
    }
  }, [enabledServers]);

  // Cleanup on unmount
  useEffect(() => {
    const clients = clientsRef.current;
    return () => {
      clients.forEach(client => {
        client.disconnect().catch(console.error);
      });
    };
  }, []);

  return mcpClients;
}
