import { useMemo } from "react";
import type { Tool, Model, ToolProvider } from "../types/chat";
import { ProviderState } from "../types/chat";
import { useProfile } from "./useProfile";
import { useToolsContext } from "./useToolsContext";
import { useArtifactsProvider } from "./useArtifactsProvider";
import { useRepositoryProvider } from "./useRepositoryProvider";
import { useSkillsProvider } from "./useSkillsProvider";
import { useArtifacts } from "./useArtifacts";
import { useRepositories } from "./useRepositories";
import defaultInstructions from "../prompts/default.txt?raw";

export interface ChatContext {
  tools: () => Promise<Tool[]>;
  instructions: () => string;
}

export function useChatContext(mode: 'voice' | 'chat' = 'chat', model?: Model | null): ChatContext {
  const { generateInstructions } = useProfile();
  const { providers, getProviderState } = useToolsContext();
  
  // Conditionally include artifacts, repository, and skills providers
  const { isEnabled: artifactsEnabled, showArtifactsDrawer } = useArtifacts();
  const { currentRepository } = useRepositories();
  const artifactsProvider = useArtifactsProvider();
  const repositoryProvider = useRepositoryProvider(currentRepository?.id || '');
  const skillsProvider = useSkillsProvider();

  const context = useMemo<ChatContext>(() => {
    const getFilteredProviders = () => {
      // Start with base providers
      let filteredProviders = providers.filter((p: ToolProvider) => getProviderState(p.id) === ProviderState.Connected);
      
      // Add artifacts provider if conditions are met (enabled OR drawer is visible)
      if (artifactsProvider && (artifactsEnabled || showArtifactsDrawer)) {
        filteredProviders = [...filteredProviders, artifactsProvider];
      }
      
      // Add repository provider if current repository is set
      if (repositoryProvider && currentRepository) {
        filteredProviders = [...filteredProviders, repositoryProvider];
      }
      
      // Add skills provider if it has enabled skills
      if (skillsProvider) {
        filteredProviders = [...filteredProviders, skillsProvider];
      }
      
      // Further filter based on model configuration
      if (model?.tools) {
        const enabledTools = new Set(model.tools.enabled || []);
        const disabledTools = new Set(model.tools.disabled || []);
        
        filteredProviders = filteredProviders.filter((provider: ToolProvider) => {
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
  }, [mode, model, generateInstructions, providers, getProviderState, artifactsEnabled, showArtifactsDrawer, artifactsProvider, repositoryProvider, currentRepository, skillsProvider]);

  return context;
}
