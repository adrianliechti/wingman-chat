import { useMemo, useEffect, useState } from "react";
import type { Tool, Model } from "../types/chat";
import { useProfile } from "./useProfile";
import { useArtifacts } from "./useArtifacts";
import { useRepository } from "./useRepository";
import { useRepositories } from "./useRepositories";
import { useBridge } from "./useBridge";
import { useSearch } from "./useSearch";
import { useImageGeneration } from "./useImageGeneration";
import { mcpClientManager, type MCPConnection } from "../lib/mcpClient";

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
  
  // MCP Integration - track connection state
  const [mcpConnected, setMcpConnected] = useState<boolean | null>(null);
  const mcpServerUrl = model?.mcpServer || null;

  // Handle MCP connection lifecycle
  useEffect(() => {
    if (!mcpServerUrl) {
      setMcpConnected(null); // null = no MCP server
      return;
    }

    let isCancelled = false;
    setMcpConnected(false); // false = connecting

    const connectToMCP = async () => {
      try {
        await mcpClientManager.connect(mcpServerUrl);
        if (!isCancelled) {
          setMcpConnected(true); // true = connected
        }
      } catch (error) {
        if (!isCancelled) {
          setMcpConnected(false); // false = connection failed, still connecting
          console.error('Failed to connect to MCP server:', error);
        }
      }
    };

    // Listen for connection changes
    const handleConnectionChange = (serverUrl: string, connection: MCPConnection | null) => {
      if (serverUrl === mcpServerUrl && !isCancelled) {
        if (connection) {
          setMcpConnected(connection.status.connected ? true : false);
        } else {
          setMcpConnected(false);
        }
      }
    };

    mcpClientManager.addListener(handleConnectionChange);
    connectToMCP();

    return () => {
      isCancelled = true;
      mcpClientManager.removeListener(handleConnectionChange);
      
      // Disconnect when component unmounts or URL changes
      if (mcpServerUrl) {
        mcpClientManager.disconnect(mcpServerUrl);
      }
    };
  }, [mcpServerUrl]);

  // Get MCP tools
  const mcpTools = useMemo((): Tool[] => {
    if (!mcpServerUrl || mcpConnected !== true) {
      return [];
    }
    return mcpClientManager.getMCPTools(mcpServerUrl);
  }, [mcpServerUrl, mcpConnected]);

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

    // MCP tools are already an array from useMemo above
    const mcpToolsList = mcpConnected === true ? mcpTools : [];
    const mcpInstructionsList = ''; // MCP instructions are empty for now

    const completionTools = [...bridgeTools, ...repositoryTools, ...filesTools, ...webSearchTools, ...imageGenTools, ...mcpToolsList];

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

    if (mcpToolsList.length > 0 && mcpInstructionsList?.trim()) {
      instructionsList.push(mcpInstructionsList);
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
