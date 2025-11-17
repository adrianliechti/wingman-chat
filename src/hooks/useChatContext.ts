import { useMemo } from "react";
import type { Tool, Model } from "../types/chat";
import { useProfile } from "./useProfile";
import { useToolsContext } from "./useToolsContext";
import defaultInstructions from "../prompts/default.txt?raw";

export interface ChatContext {
  tools: () => Promise<Tool[]>;
  instructions: () => string;
}

/**
 * Shared hook for gathering completion tools and instructions
 * Used by both ChatProvider and VoiceProvider
 */
export function useChatContext(mode: 'voice' | 'chat' = 'chat', model?: Model | null): ChatContext {
  const { generateInstructions } = useProfile();
  const { providers } = useToolsContext();

  const context = useMemo<ChatContext>(() => {
    const getFilteredProviders = () => {
      // Filter providers that are enabled
      let filteredProviders = providers.filter(p => p.isEnabled);
      
      // Further filter based on model configuration
      if (model?.tools) {
        const enabledTools = new Set(model.tools.enabled || []);
        const disabledTools = new Set(model.tools.disabled || []);
        
        filteredProviders = filteredProviders.filter(provider => {
          // Check provider ID against enabled/disabled lists
          const matchId = provider.id;
          
          // If there are enabled tools specified, only include those
          if (enabledTools.size > 0) {
            return enabledTools.has(matchId);
          }
          // Otherwise, exclude disabled tools
          return !disabledTools.has(matchId);
        });
      }
      
      return filteredProviders;
    };

    return {
      tools: async () => {
        const filteredProviders = getFilteredProviders();
        
        // Extract tools from filtered providers asynchronously
        const toolsPromises = filteredProviders.map(p => p.tools());
        const toolsArrays = await Promise.all(toolsPromises);

        console.log("Compiled Tools from Providers:", toolsArrays);

        return toolsArrays.flat();
      },
      
      instructions: () => {
        const filteredProviders = getFilteredProviders();
        const profileInstructions = generateInstructions();
        
        const instructionsList: string[] = [];

        if (profileInstructions.trim()) {
          instructionsList.push(profileInstructions);
        }
        
        if (defaultInstructions.trim()) {
          instructionsList.push(defaultInstructions);
        }

        if (mode === 'voice') {
          instructionsList.push('Respond concisely and naturally for voice interaction.');
        }

        // Add instructions from filtered providers
        filteredProviders.forEach(provider => {
          if (provider.instructions?.trim()) {
            instructionsList.push(provider.instructions);
          }
        });

        console.log("Compiled Instructions:", instructionsList);

        return instructionsList.join('\n\n');
      }
    };
  }, [mode, model, generateInstructions, providers]);

  return context;
}
