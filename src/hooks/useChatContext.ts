import { useState, useEffect } from "react";
import type { Tool, Model } from "../types/chat";
import { useProfile } from "./useProfile";
import { useToolsContext } from "./useToolsContext";
import defaultInstructions from "../prompts/default.txt?raw";

export interface ChatContext {
  tools: Tool[];
  instructions: string;
}

/**
 * Shared hook for gathering completion tools and instructions
 * Used by both ChatProvider and VoiceProvider
 */
export function useChatContext(mode: 'voice' | 'chat' = 'chat', model?: Model | null): ChatContext {
  const { generateInstructions } = useProfile();
  const { providers } = useToolsContext();
  const [context, setContext] = useState<ChatContext>({ tools: [], instructions: '' });

  useEffect(() => {
    const loadContext = async () => {
      const profileInstructions = generateInstructions();
      
      // Filter providers that are enabled
      let filteredProviders = providers.filter(p => p.enabled);
      
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
      
      // Extract tools from filtered providers asynchronously
      const toolsPromises = filteredProviders.map(p => p.tools());
      const toolsArrays = await Promise.all(toolsPromises);
      const completionTools = toolsArrays.flat();

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

      console.log('instructions:', instructionsList.join('\n\n'));
      console.log('tools:', completionTools);

      setContext({
        tools: completionTools,
        instructions: instructionsList.join('\n\n'),
      });
    };

    loadContext();
  }, [
    mode,
    model,
    generateInstructions,
    providers
  ]);

  return context;
}
