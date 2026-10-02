import { useMemo } from "react";
import type { ChatMiddleware } from "@tanstack/ai";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { getMemoryManager, type MemoryManager } from "@/features/agent/lib/memoryManager";
import { mountMemoryFiles } from "@/features/agent/lib/memoryFileMount";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import defaultInstructions from "@/features/chat/prompts/default.txt?raw";
import voiceInstructions from "@/features/chat/prompts/voice.txt?raw";
import voiceToolsInstructions from "@/features/chat/prompts/voice-tools.txt?raw";
import { useProfile } from "@/features/settings/hooks/useProfile";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { createSubagentTool } from "@/features/tools/lib/subagent";
import { getConfig } from "@/shared/config";
import { findModel } from "@/shared/lib/models";
import type { Model, Tool, ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { ASK_QUESTIONS_TOOL } from "../lib/questionsTool";
import { useImageTool } from "./useImageTool";

export interface ChatContext {
  tools: () => Tool[];
  instructions: () => string;
  runtimeContext: () => string;
  memory: () => MemoryManager | undefined;
  middleware: () => ChatMiddleware[];
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
          ? (findModel(models, currentAgent.model) ?? model)
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
    const chatMiddleware = (filteredProviders: ToolProvider[]) =>
      filteredProviders.flatMap((provider) => provider.chat?.middleware ?? []);
    // Memory's runtime context is only for realtime; chat recalls memory per request.
    const providerRuntimeContext = (filteredProviders: ToolProvider[], includeMemory: boolean) =>
      filteredProviders
        .filter((provider) => includeMemory || provider.id !== "memory")
        .map((provider) => provider.runtimeContext?.trim())
        .filter((s): s is string => !!s)
        .join("\n\n");

    return {
      memory,
      middleware: () => (mode === "chat" ? chatMiddleware(getFilteredProviders()) : []),
      tools: () => {
        const filteredProviders = getFilteredProviders();

        // Extract tools from filtered providers
        const toolsArrays = filteredProviders.map(
          (provider) => (mode === "chat" ? (provider.chat ?? provider) : provider).tools,
        );

        // Image generation follows renderer availability, independent of Studio.
        const baseTools = mountMemoryFiles([...toolsArrays.flat(), ...(imageTool ? [imageTool] : [])], memory());
        // Clarification is a core chat capability, independent of provider
        // selections and model allowlists; native child runs can ask too.
        const tools = [...baseTools, ASK_QUESTIONS_TOOL];

        const subagentModel =
          mode === "voice"
            ? (models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id ?? null)
            : (model?.id ?? null);

        // Delegated runs always use chat, even when invoked from realtime voice.
        const chatProviders = filteredProviders.map((provider) => provider.chat ?? provider);
        const middleware = chatMiddleware(filteredProviders);
        const subagentTools =
          mode === "voice"
            ? mountMemoryFiles(
                [...chatProviders.flatMap((provider) => provider.tools), ...(imageTool ? [imageTool] : [])],
                memory(),
              )
            : tools;

        if ((baseTools.length === 0 && middleware.length === 0) || !subagentModel) {
          return tools;
        }

        const providerInstructions = chatProviders
          .map((provider) => provider.instructions?.trim())
          .filter((s): s is string => !!s)
          .join("\n\n");
        return [
          ...tools,
          createSubagentTool(
            subagentModel,
            providerInstructions,
            subagentTools,
            providerRuntimeContext(filteredProviders, false),
            middleware,
          ),
        ];
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
          const instructions = (mode === "chat" ? (provider.chat ?? provider) : provider).instructions;
          if (instructions?.trim()) {
            instructionsList.push(instructions);
          }
        });

        return instructionsList.join("\n\n");
      },
      runtimeContext: () => providerRuntimeContext(getFilteredProviders(), mode === "voice"),
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
