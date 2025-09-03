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
  
  // Get the MCP server URL from the provided model
  const mcpServerUrl = model?.mcpServer || null;
  const shouldConnect = !!mcpServerUrl;
  
  // Create MCP client configuration based on model
  const mcpConfig = useMemo(() => {
    if (!shouldConnect || !mcpServerUrl) {
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
      autoRetry: 3000,
    };
  }, [shouldConnect, mcpServerUrl]);

  // Always call the hook to satisfy React's rules
  const mcpResult = useMcp(mcpConfig);

  // Extract values, but only use them when we should be connected
  const state = shouldConnect ? mcpResult.state : 'disconnected';
  const tools = shouldConnect ? mcpResult.tools : null;
  const callTool = shouldConnect ? mcpResult.callTool : null;
  
  // Memoize disconnect to avoid dependency issues
  const disconnect = useMemo(() => {
    return mcpResult.disconnect || (() => {});
  }, [mcpResult.disconnect]);

  console.log('useMCP state:', state, 'server:', mcpServerUrl, 'shouldConnect:', shouldConnect);

  // Handle model changes - disconnect and reconnect when model changes
  useEffect(() => {
    const hasModelChanged = previousModelRef.current !== model;
    
    if (hasModelChanged) {
      console.log('Model changed from', previousModelRef.current?.id, 'to', model?.id);
      
      // If previous model had MCP server, disconnect first
      if (previousModelRef.current?.mcpServer) {
        console.log('Disconnecting from previous MCP server:', previousModelRef.current.mcpServer);
        disconnect();
      }
      
      // Update the ref
      previousModelRef.current = model;
      
      // New connection will be handled automatically by the useMcp hook
      // due to the mcpConfig change
      if (shouldConnect) {
        console.log('Will connect to new MCP server:', mcpServerUrl);
      }
    }
  }, [model, shouldConnect, mcpServerUrl, disconnect]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (shouldConnect) {
        disconnect();
      }
    };
  }, [shouldConnect, disconnect]);

  // Convert use-mcp tools to our Tool format
  const mcpTools = useMemo((): Tool[] => {
    if (!shouldConnect || !tools || state !== 'ready' || !callTool) {
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
  }, [tools, state, callTool, shouldConnect]);

  const mcpInstructions = useMemo((): string => {
    return '';
  }, []);

  // Implementation of the interface methods - removed since we simplified
  const isConnected = shouldConnect && state === 'ready';
  
  // Simple connection status based on use-mcp state
  let connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error' = 'disconnected';
  if (shouldConnect && mcpServerUrl) {
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
        connectionStatus = 'error';
        break;
      default:
        connectionStatus = 'disconnected';
    }
  }

  console.log('useMCP connectionStatus:', connectionStatus, 'for server:', mcpServerUrl, 'state:', state);

  return {
    isConnected: Boolean(isConnected),
    connectionStatus,
    mcpTools: () => mcpTools,
    mcpInstructions: () => mcpInstructions,
    isEnabled: Boolean(isConnected),
  };
}