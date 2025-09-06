import { useMemo, useEffect, useRef } from 'react';
import { useMcp } from 'use-mcp/react';
import type { Tool, Model } from '../types/chat';

export interface MCPHook {
  isConnected: boolean;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  mcpTools: () => Tool[];
  mcpInstructions: () => string;
  isEnabled: boolean;
}

export function useMCP(model?: Model | null): MCPHook {
  const previousModelRef = useRef<Model | null | undefined>(undefined);
  const wasEverConnectedRef = useRef<boolean>(false);
  const reconnectIntervalRef = useRef<number | null>(null);
  
  // Get the MCP server URL from the provided model
  const mcpServerUrl = model?.mcpServer || null;
  
  // Create MCP client configuration based on model
  const mcpConfig = useMemo(() => {
    if (!mcpServerUrl) {
      // Return a minimal config that shouldn't cause connection attempts
      return {
        url: '', // Empty string should be safe
        clientName: 'Wingman Chat',
        autoReconnect: false,
        autoRetry: 0,
      };
    }
    
    return {
      url: mcpServerUrl,
      clientName: 'Wingman Chat',
      autoReconnect: true,
      autoRetry: 3000, // Retry every 3 seconds
    };
  }, [mcpServerUrl]);

  // Always call the hook to satisfy React's rules
  const mcpResult = useMcp(mcpConfig);

  // Extract values, but only use them when we should be connected
  const state = mcpServerUrl ? mcpResult.state : 'disconnected';
  const tools = mcpServerUrl ? mcpResult.tools : null;
  const callTool = mcpServerUrl ? mcpResult.callTool : null;
  const retry = mcpResult.retry;
  
  // Memoize disconnect to avoid dependency issues
  const disconnect = useMemo(() => {
    return mcpResult.disconnect || (() => {});
  }, [mcpResult.disconnect]);

  // Track if we were ever connected
  useEffect(() => {
    if (state === 'ready' && mcpServerUrl) {
      wasEverConnectedRef.current = true;
      // Clear any existing reconnect interval since we're connected
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }
    }
  }, [state, mcpServerUrl]);

  // Handle endless reconnection for failed states
  useEffect(() => {
    // Clear any existing interval first
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current);
      reconnectIntervalRef.current = null;
    }

    // If we were connected before and now in failed/disconnected state, keep trying to reconnect
    if (wasEverConnectedRef.current && 
        (state === 'failed' || state === 'disconnected') && 
        retry && 
        mcpServerUrl) {
      
      console.log('MCP connection lost, setting up endless reconnection attempts...');
      
      // Set up interval to keep trying reconnection
      reconnectIntervalRef.current = setInterval(() => {
        console.log('Attempting to reconnect to MCP server...');
        retry();
      }, 5000); // Try every 5 seconds
    }

    // Cleanup function
    return () => {
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }
    };
  }, [state, retry, mcpServerUrl]);

  // Handle model changes - disconnect and reconnect when model changes
  useEffect(() => {
    const hasModelChanged = previousModelRef.current !== model;
    
    if (hasModelChanged) {      
      // Reset the "was ever connected" flag when switching models
      if (previousModelRef.current?.mcpServer !== model?.mcpServer) {
        wasEverConnectedRef.current = false;
        
        // Clear any reconnect interval
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current);
          reconnectIntervalRef.current = null;
        }
      }
      
      // If previous model had MCP server and it's different from current, disconnect first
      if (previousModelRef.current?.mcpServer && 
          previousModelRef.current.mcpServer !== model?.mcpServer) {
        console.log('Disconnecting from previous MCP server:', previousModelRef.current.mcpServer);
        disconnect();
      }
      
      // Update the ref
      previousModelRef.current = model;
      
      // New connection will be handled automatically by the useMcp hook
      // due to the mcpConfig change
      if (mcpServerUrl) {
        console.log('Will connect to new MCP server:', mcpServerUrl);
      }
    }
  }, [model, mcpServerUrl, disconnect]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mcpServerUrl) {
        disconnect();
        wasEverConnectedRef.current = false;
        
        // Clear any reconnect interval
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current);
          reconnectIntervalRef.current = null;
        }
      }
    };
  }, [mcpServerUrl, disconnect]);

  // Convert use-mcp tools to our Tool format
  const mcpTools = useMemo((): Tool[] => {
    if (!mcpServerUrl || !tools || state !== 'ready' || !callTool) {
      return [];
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || {},

      function: async (args: Record<string, unknown>) => {
        if (!callTool) {
          console.error(`MCP tool ${tool.name} called but callTool is not available`);
          return "tool unavailable";
        }

        try {
          console.log("call MCP tool", tool.name, args);
          const result = await callTool(tool.name, args);
          
          // Handle different result formats
          if (typeof result === 'string') {
            return result;
          }
          
          if (result && typeof result === 'object') {
            // If result has content array (MCP format)
            if (Array.isArray(result.content)) {
              return result.content
                .map((item: { text?: string } | unknown) => 
                  (item && typeof item === 'object' && 'text' in item) 
                    ? item.text 
                    : JSON.stringify(item)
                )
                .filter((text: string) => text.trim() !== "")
                .join("\n\n") || "no content";
            }
            
            // Otherwise stringify the result
            return JSON.stringify(result);
          }
          
          return "no result";
        } catch (error) {
          console.error(`Error calling MCP tool ${tool.name}:`, error);
          return "tool failed";
        }
      },
    }));
  }, [tools, state, callTool, mcpServerUrl]);

  const mcpInstructions = useMemo((): string => {
    return '';
  }, []);

  // Implementation of the interface methods - removed since we simplified
  const isConnected = mcpServerUrl && state === 'ready';
  
  // Simple connection status based on use-mcp state
  let connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error' = 'disconnected';
  if (mcpServerUrl) {
    switch (state) {
      case 'ready':
        connectionStatus = 'connected';
        break;
      case 'connecting':
      case 'loading':
      case 'discovering':
      case 'pending_auth':
      case 'authenticating':
        connectionStatus = 'connecting';
        break;
      case 'failed':
        // Show as 'connecting' if we're actively trying to reconnect
        connectionStatus = wasEverConnectedRef.current ? 'connecting' : 'error';
        if (!wasEverConnectedRef.current) {
          console.log('MCP initial connection failed');
        }
        break;
      case 'disconnected':
        // Show as 'connecting' if we were connected before and will try to reconnect
        connectionStatus = wasEverConnectedRef.current ? 'connecting' : 'disconnected';
        if (wasEverConnectedRef.current) {
          console.log('MCP disconnected, will attempt reconnection');
        }
        break;
      default:
        connectionStatus = 'disconnected';
    }
  }

  return {
    isConnected: Boolean(isConnected),
    connectionStatus,
    mcpTools: () => mcpTools,
    mcpInstructions: () => mcpInstructions,
    isEnabled: Boolean(isConnected),
  };
}