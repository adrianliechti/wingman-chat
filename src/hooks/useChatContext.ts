import { useMemo } from "react";
import type { Tool } from "../types/chat";
import { useProfile } from "./useProfile";
import { useArtifacts } from "./useArtifacts";
import { useRepository } from "./useRepository";
import { useRepositories } from "./useRepositories";
import { useBridge } from "./useBridge";
import { useSearch } from "./useSearch";
import { useImageGeneration } from "./useImageGeneration";

export interface ChatContext {
  tools: Tool[];
  instructions: string;
}

/**
 * Shared hook for gathering completion tools and instructions
 * Used by both ChatProvider and VoiceProvider
 */
export function useChatContext(mode: 'voice' | 'chat' = 'chat'): ChatContext {
  const { generateInstructions } = useProfile();
  const { artifactsTools, artifactsInstructions, isEnabled: isArtifactsEnabled } = useArtifacts();
  const { currentRepository } = useRepositories();
  
  // Override query mode based on context mode
  const queryMode = mode === 'voice' ? 'rag' : 'auto';
  const { queryTools, queryInstructions } = useRepository(currentRepository?.id || '', queryMode);
  
  const { bridgeTools, bridgeInstructions } = useBridge();
  const { searchTools, searchInstructions } = useSearch();
  const { imageGenerationTools, imageGenerationInstructions } = useImageGeneration();

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

    const completionTools = [...bridgeTools, ...repositoryTools, ...filesTools, ...webSearchTools, ...imageGenTools];

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
      instructions: instructionsList.join('\n\n')
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
    imageGenerationInstructions
  ]);
}
