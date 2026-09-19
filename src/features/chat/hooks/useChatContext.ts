import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { getMemoryManager, type MemoryManager } from "@/features/agent/lib/memoryManager";
import { mountMemoryFiles } from "@/features/agent/lib/memoryFileMount";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import defaultInstructions from "@/features/chat/prompts/default.txt?raw";
import voiceInstructions from "@/features/chat/prompts/voice.txt?raw";
import voiceToolsInstructions from "@/features/chat/prompts/voice-tools.txt?raw";
import { useProfile } from "@/features/settings/hooks/useProfile";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import { createSubagentTool } from "@/features/tools/lib/subagent";
import { getConfig } from "@/shared/config";
import type { Model, Tool, ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { ASK_QUESTIONS_TOOL } from "../lib/questionsTool";
import { useImageTool } from "./useImageTool";

export interface ChatContext {
  tools: () => Promise<Tool[]>;
  instructions: () => string;
  runtimeContext: () => string;
  memory: () => MemoryManager | undefined;
}

export function useChatContext(
  mode: "voice" | "chat" = "chat",
  model?: Model | null,
  models: Model[] = [],
): ChatContext {
  const { generateInstructions } = useProfile();
  const { providers, coreProviders, getProviderState } = useToolsContext();

  // Artifacts provider — non-null whenever the feature is available, in which
  // case it's always active (no per-chat enable toggle).
  const artifactsProvider = useArtifactsProvider();
  const imageTool = useImageTool();

  // Get current agent for its instructions
  const { currentAgent } = useAgents();

  const context = useMemo<ChatContext>(() => {
    const getFilteredProviders = () => {
      // Start with base providers (includes agent repo, skills, bridges, and conditionally enabled built-in tools)
      let filteredProviders = providers.filter((p: ToolProvider) => getProviderState(p.id) === ProviderState.Connected);

      // Add the artifacts provider whenever the feature is available (the
      // provider is null otherwise). It may already be present if explicitly
      // enabled via the agent tools toggle.
      const artifactsAlreadyIncluded = filteredProviders.some((p: ToolProvider) => p.id === "artifacts");
      if (!artifactsAlreadyIncluded && artifactsProvider) {
        filteredProviders = [...filteredProviders, artifactsProvider];
      }

      // Further filter based on model configuration
      const filterModel: Pick<Model, "tools"> | null | undefined =
        mode === "voice" && (model?.id === "realtime" || !model?.tools) && currentAgent?.model
          ? (models.find((m) => m.id === currentAgent.model) ?? model)
          : model;

      if (filterModel?.tools) {
        const enabledTools = new Set(filterModel.tools.enabled || []);
        const disabledTools = new Set(filterModel.tools.disabled || []);

        filteredProviders = filteredProviders.filter((provider: ToolProvider) => {
          const matchId = provider.id;

          if (enabledTools.size > 0) {
            return enabledTools.has(matchId);
          }
          return !disabledTools.has(matchId);
        });
      }

      // Core providers (e.g. Skill Builder) are always available and exempt from
      // model tool allow/deny lists, so append them after all filtering.
      filteredProviders = [...filteredProviders, ...coreProviders];

      return filteredProviders;
    };

    const memory = () =>
      currentAgent?.memory && getConfig().memory && getFilteredProviders().some((p) => p.id === "memory")
        ? getMemoryManager(currentAgent.id)
        : undefined;

    return {
      memory,
      tools: async () => {
        // Make the active chat model available to the python `llm` helper
        // so it inherits whatever the user is currently chatting with.
        setInterpreterModel(model?.id ?? null);

        const filteredProviders = getFilteredProviders();

        // Extract tools from filtered providers
        const toolsArrays = filteredProviders.map((p: ToolProvider) => p.tools);

        console.log("Compiled Tools from Providers:", toolsArrays);

        // Image generation follows renderer availability, independent of Studio.
        const baseTools = mountMemoryFiles([...toolsArrays.flat(), ...(imageTool ? [imageTool] : [])], memory());
        // Clarification is a core chat capability, independent of provider
        // selections and model allowlists. Only the outer chat owns elicitation.
        const tools = [...baseTools, ASK_QUESTIONS_TOOL];

        const subagentModel =
          mode === "voice"
            ? (models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id ?? null)
            : (model?.id ?? null);

        if (baseTools.length === 0 || !subagentModel) {
          return tools;
        }

        const providerInstructions = filteredProviders
          .map((p: ToolProvider) => p.instructions?.trim())
          .filter((s): s is string => !!s)
          .join("\n\n");
        const providerRuntimeContext = filteredProviders
          .filter((p) => p.id !== "memory")
          .map((p: ToolProvider) => p.runtimeContext?.trim())
          .filter((s): s is string => !!s)
          .join("\n\n");

        return [...tools, createSubagentTool(subagentModel, providerInstructions, baseTools, providerRuntimeContext)];
      },

      instructions: () => {
        const filteredProviders = getFilteredProviders();
        const profileInstructions = generateInstructions();

        const instructionsList: string[] = [];

        const globalInstructions = getConfig().chat?.instructions;
        if (globalInstructions?.trim()) {
          instructionsList.push(globalInstructions);
        }

        if (model?.instructions?.trim()) {
          instructionsList.push(model.instructions);
        }

        if (defaultInstructions.trim()) {
          instructionsList.push(defaultInstructions);
        }

        if (profileInstructions.trim()) {
          instructionsList.push(profileInstructions);
        }

        if (currentAgent?.instructions?.trim()) {
          instructionsList.push(currentAgent.instructions);
        }

        if (mode === "voice") {
          instructionsList.push(voiceInstructions);
          const hasTools = filteredProviders.some((p: ToolProvider) => p.tools.length > 0);
          if (hasTools) instructionsList.push(voiceToolsInstructions);
        }

        // Add instructions from filtered providers
        filteredProviders.forEach((provider: ToolProvider) => {
          if (provider.instructions?.trim()) {
            instructionsList.push(provider.instructions);
          }
        });

        console.log("Compiled Instructions:", instructionsList);

        return instructionsList.join("\n\n");
      },
      runtimeContext: () =>
        getFilteredProviders()
          .filter((provider) => mode === "voice" || provider.id !== "memory")
          .map((provider) => provider.runtimeContext?.trim())
          .filter(Boolean)
          .join("\n\n"),
    };
  }, [
    mode,
    model,
    models,
    generateInstructions,
    providers,
    coreProviders,
    getProviderState,
    artifactsProvider,
    imageTool,
    currentAgent,
  ]);

  return context;
}
