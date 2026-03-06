import { useMemo } from "react";
import type { Tool, Model, ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { useProfile } from "@/features/settings/hooks/useProfile";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useAgents } from "@/features/agent/hooks/useAgents";
import defaultInstructions from "@/features/chat/prompts/default.txt?raw";

export interface ChatContext {
  tools: () => Promise<Tool[]>;
  instructions: () => string;
}

export function useChatContext(mode: 'voice' | 'chat' = 'chat', model?: Model | null): ChatContext {
  const { generateInstructions } = useProfile();
  const { providers, getProviderState } = useToolsContext();
  
  // Conditionally include artifacts provider
  const { isEnabled: artifactsEnabled, showArtifactsDrawer } = useArtifacts();
  const artifactsProvider = useArtifactsProvider();
  
  // Get current agent for its instructions
  const { currentAgent } = useAgents();

  const context = useMemo<ChatContext>(() => {
    const getFilteredProviders = () => {
      // Start with base providers (includes agent repo, skills, bridges, and conditionally enabled built-in tools)
      let filteredProviders = providers.filter((p: ToolProvider) => getProviderState(p.id) === ProviderState.Connected);
      
      // Add artifacts provider if conditions are met (enabled OR drawer is visible)
      if (artifactsProvider && (artifactsEnabled || showArtifactsDrawer)) {
        filteredProviders = [...filteredProviders, artifactsProvider];
      }
      
      // Further filter based on model configuration
      if (model?.tools) {
        const enabledTools = new Set(model.tools.enabled || []);
        const disabledTools = new Set(model.tools.disabled || []);
        
        filteredProviders = filteredProviders.filter((provider: ToolProvider) => {
          const matchId = provider.id;
          
          if (enabledTools.size > 0) {
            return enabledTools.has(matchId);
          }
          return !disabledTools.has(matchId);
        });
      }
      
      return filteredProviders;
    };

    return {
      tools: async () => {
        const filteredProviders = getFilteredProviders();
        
        // Extract tools from filtered providers
        const toolsArrays = filteredProviders.map((p: ToolProvider) => p.tools);

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

        // Add agent-level instructions
        if (currentAgent?.instructions?.trim()) {
          instructionsList.push(currentAgent.instructions);
        }

        if (mode === 'voice') {
          instructionsList.push('Respond concisely and naturally for voice interaction.');
        }

        // Add instructions from filtered providers
        filteredProviders.forEach((provider: ToolProvider) => {
          if (provider.instructions?.trim()) {
            instructionsList.push(provider.instructions);
          }
        });

        console.log("Compiled Instructions:", instructionsList);

        return instructionsList.join('\n\n');
      }
    };
  }, [mode, model, generateInstructions, providers, getProviderState, artifactsEnabled, showArtifactsDrawer, artifactsProvider, currentAgent]);

  return context;
}
