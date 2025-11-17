import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getConfig } from "../config";
import type { MCP, Tool, ToolProvider } from "../types/chat";
import { MCPClient } from "../lib/mcp";

export interface MCPConnection {
  mcp: MCP;
  client: MCPClient;

  instructions: string | undefined;

  tools: Tool[];
}

export function useMCP() {
  const config = getConfig();
  const mcps = useMemo(() => config.mcps || [], [config.mcps]);
  
  const [connectedMCPs, setConnectedMCPs] = useState<Map<string, MCPConnection>>(new Map());
  const [connectingMCPs, setConnectingMCPs] = useState<Set<string>>(new Set());
  const clientsRef = useRef<Map<string, MCPClient>>(new Map());

  // Helper to find MCP by id
  const findMCP = useCallback((id: string) => {
    return mcps.find(m => m.id === id);
  }, [mcps]);

  // Cleanup on unmount
  useEffect(() => {
    const clients = clientsRef.current;
    return () => {
      // Disconnect all clients on unmount
      clients.forEach(client => {
        client.disconnect().catch(console.error);
      });
      clients.clear();
    };
  }, []);

  const connectMCP = useCallback(async (id: string) => {
    const mcp = findMCP(id);
    if (!mcp) {
      throw new Error(`MCP with id ${id} not found`);
    }

    // Check if already connected
    if (connectedMCPs.has(id)) {
      return;
    }

    // Check if already connecting
    if (connectingMCPs.has(id)) {
      return;
    }

    try {
      setConnectingMCPs(prev => new Set(prev).add(id));

      const client = new MCPClient(mcp.url);
      clientsRef.current.set(id, client);
      
      await client.connect();
      
      const tools = client.getTools();
      const instructions = client.getInstructions();
      
      setConnectedMCPs(prev => {
        const next = new Map(prev);
        next.set(id, { mcp, client, instructions, tools });
        return next;
      });

      setConnectingMCPs(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (error) {
      console.error(`Failed to connect to MCP ${mcp.name}:`, error);
      
      // Clean up failed connection
      const client = clientsRef.current.get(id);
      if (client) {
        await client.disconnect();
        clientsRef.current.delete(id);
      }

      setConnectingMCPs(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      
      throw error;
    }
  }, [connectedMCPs, connectingMCPs, findMCP]);

  const disconnectMCP = useCallback(async (id: string) => {
    const connection = connectedMCPs.get(id);
    if (!connection) {
      return;
    }

    try {
      await connection.client.disconnect();
      clientsRef.current.delete(id);
      
      setConnectedMCPs(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } catch (error) {
      console.error(`Failed to disconnect from MCP ${connection.mcp.name}:`, error);
      throw error;
    }
  }, [connectedMCPs]);

  const toggleMCP = useCallback(async (id: string) => {
    if (connectedMCPs.has(id)) {
      await disconnectMCP(id);
    } else {
      await connectMCP(id);
    }
  }, [connectedMCPs, connectMCP, disconnectMCP]);

  const isConnected = useCallback((id: string) => {
    return connectedMCPs.has(id);
  }, [connectedMCPs]);

  const isConnecting = useCallback((id: string) => {
    return connectingMCPs.has(id);
  }, [connectingMCPs]);

  const getAllProviders = useCallback(() => {
    const providers: ToolProvider[] = [];
    connectedMCPs.forEach(connection => {
      providers.push({
        id: connection.mcp.id,

        name: connection.mcp.name,
        description: connection.mcp.description,

        instructions: connection.instructions,

        tools: async () => connection.tools,
      });
    });
    return providers;
  }, [connectedMCPs]);

  return {
    mcps,
    connectedMCPs,
    connectingMCPs,
    connectMCP,
    disconnectMCP,
    toggleMCP,
    isConnected,
    isConnecting,
    getAllProviders,
  };
}
