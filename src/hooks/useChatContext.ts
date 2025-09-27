import { useMemo, useEffect, useState, useRef } from "react";
import type { Tool, Model } from "../types/chat";
import { useProfile } from "./useProfile";
import { useArtifacts } from "./useArtifacts";
import { useRepository } from "./useRepository";
import { useRepositories } from "./useRepositories";
import { useBridge } from "./useBridge";
import { useSearch } from "./useSearch";
import { useImageGeneration } from "./useImageGeneration";
import { MCPClient } from "../lib/mcp";

export interface ChatContext {
  tools: Tool[];
  instructions: string;
  mcpConnected: boolean | null; // null = no MCP server, false = connecting, true = connected
  mcpTools: Tool[];
}

/**
 * Shared hook for gathering completion tools and instructions
 * Used by both ChatProvider and VoiceProvider
 */
export function useChatContext(mode: 'voice' | 'chat' = 'chat', model?: Model | null): ChatContext {
  const { generateInstructions } = useProfile();
  const { artifactsTools, artifactsInstructions, isEnabled: isArtifactsEnabled } = useArtifacts();
  const { currentRepository } = useRepositories();
  
  // Override query mode based on context mode
  const queryMode = mode === 'voice' ? 'rag' : 'auto';
  const { queryTools, queryInstructions } = useRepository(currentRepository?.id || '', queryMode);
  
  const { bridgeTools, bridgeInstructions } = useBridge();
  const { searchTools, searchInstructions } = useSearch();
  const { imageGenerationTools, imageGenerationInstructions } = useImageGeneration();
  
  // MCP Integration - simplified client management
  const [mcpConnected, setMcpConnected] = useState<boolean | null>(null);
  const [mcpTools, setMcpTools] = useState<Tool[]>([]);
  const mcpClientRef = useRef<MCPClient | null>(null);
  const mcpServerUrl = model?.mcpServer || null;

  // Handle MCP connection lifecycle - reconnect when model changes
  useEffect(() => {
    let isCancelled = false;

    // Cleanup previous client
    const cleanupPreviousClient = async () => {
      if (mcpClientRef.current) {
        await mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
    };

    const connectToMCP = async () => {
      if (!mcpServerUrl) {
        setMcpConnected(null); // null = no MCP server
        setMcpTools([]);
        return;
      }

      try {
        await cleanupPreviousClient();
        
        if (isCancelled) return;
        
        setMcpConnected(false); // false = connecting
        setMcpTools([]);

        const client = new MCPClient(mcpServerUrl);
        mcpClientRef.current = client;
        
        await client.connect();
        
        if (!isCancelled) {
          setMcpConnected(true); // true = connected
          setMcpTools(client.getChatTools());
        }
      } catch (error) {
        if (!isCancelled) {
          setMcpConnected(false); // false = connection failed
          setMcpTools([]);
          console.error('Failed to connect to MCP server:', error);
        }
      }
    };

    connectToMCP();

    return () => {
      isCancelled = true;
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
    };
  }, [mcpServerUrl]); // Reconnect when mcpServerUrl changes

  return useMemo(() => {
    const profileInstructions = generateInstructions();
    
    const filesTools = isArtifactsEnabled ? artifactsTools() : [];
    const filesInstructions = isArtifactsEnabled ? artifactsInstructions() : '';
    
    const repositoryTools = currentRepository ? queryTools() : [];
    const repositoryInstructions = currentRepository ? queryInstructions() : '';

    const webSearchTools = searchTools();
    const webSearchInstructions = searchInstructions();

    const imageGenTools = imageGenerationTools();
    const imageGenInstructions = imageGenerationInstructions();

    const completionTools = [...bridgeTools, ...repositoryTools, ...filesTools, ...webSearchTools, ...imageGenTools, ...mcpTools];

    const instructionsList: string[] = [];

    if (profileInstructions.trim()) {
      instructionsList.push(profileInstructions);
    }

    if (filesInstructions.trim()) {
      instructionsList.push(filesInstructions);
    }

    if (repositoryInstructions.trim()) {
      instructionsList.push(repositoryInstructions);
    }

    if (bridgeTools.length > 0 && bridgeInstructions?.trim()) {
      instructionsList.push(bridgeInstructions);
    }

    if (webSearchTools.length > 0 && webSearchInstructions?.trim()) {
      instructionsList.push(webSearchInstructions);
    }

    if (imageGenTools.length > 0 && imageGenInstructions?.trim()) {
      instructionsList.push(imageGenInstructions);
    }

    // Add mode-specific instructions
    if (mode === 'voice') {
      instructionsList.push('Respond concisely and naturally for voice interaction.');
    }

    return {
      tools: completionTools,
      instructions: instructionsList.join('\n\n'),
      mcpConnected,
      mcpTools
    };
  }, [
    mode,
    generateInstructions,
    isArtifactsEnabled,
    artifactsTools,
    artifactsInstructions,
    currentRepository,
    queryTools,
    queryInstructions,
    bridgeTools,
    bridgeInstructions,
    searchTools,
    searchInstructions,
    imageGenerationTools,
    imageGenerationInstructions,
    mcpConnected,
    mcpTools
  ]);
}
