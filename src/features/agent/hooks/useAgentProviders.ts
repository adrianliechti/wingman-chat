import { BrainCircuit, Package } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import memoryPrompt from "@/features/agent/prompts/memory.txt?raw";
import type { Agent } from "@/features/agent/types/agent";
import { createRepositoryTools } from "@/features/repository/lib/repository-tools";
import repositoryInstructions from "@/features/repository/prompts/repository.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";
import { useAgentFiles } from "./useAgentFiles";
import { getMemoryManager } from "../lib/memoryManager";
import { recallMemory } from "../lib/memoryRecall";
import { subscribeMemory } from "../lib/memoryEvents";
import { resumeMemoryLearning } from "../lib/memoryLearning";
import { reconcileMemorySources } from "../lib/memorySources";

export interface AgentProviders {
  /** All tool providers assembled from this agent's config */
  providers: ToolProvider[];
  /** Tool provider IDs this agent has enabled (e.g. "web", "artifacts") */
  enabledTools: string[];
}

/**
 * Given an Agent, assembles its ToolProviders:
 * - Repository provider (if files exist)
 * - Memory provider (if enabled)
 * Skills are assembled separately by useSkillsProvider (a single provider across
 * agent / no-agent modes). Also returns the agent.tools list so ToolsProvider
 * knows which built-in tools to activate.
 */
export function useAgentProviders(agent: Agent | null): AgentProviders {
  const agentId = agent?.id || "";
  const { files, queryChunks } = useAgentFiles(agentId);

  // --- Repository provider (files only) ---
  const repositoryProvider = useMemo<ToolProvider | null>(() => {
    if (!agent || files.length === 0) return null;

    return {
      id: "repository",
      name: "Repository",
      description: "File access tools for your repository",
      icon: Package,
      instructions: repositoryInstructions || undefined,
      tools: createRepositoryTools(files, queryChunks),
    };
  }, [agent, files, queryChunks]);

  // --- Memory provider ---
  const memoryEnabled = !!agent?.memory;
  const [coreMemory, setCoreMemory] = useState({ agentId: "", content: "" });
  useEffect(() => {
    if (!memoryEnabled) return;
    let active = true;
    const manager = getMemoryManager(agentId);
    const refresh = async () => {
      await reconcileMemorySources(manager);
      const snapshot = await manager.snapshot();
      if (active) {
        setCoreMemory({ agentId, content: recallMemory(snapshot, "") });
        resumeMemoryLearning(manager);
      }
    };
    const load = () => {
      void refresh().catch(console.error);
    };
    load();
    const unsubscribe = subscribeMemory(agentId, load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agentId, memoryEnabled]);

  const memoryProvider = useMemo<ToolProvider | null>(
    () =>
      memoryEnabled
        ? {
            id: "memory",
            name: "Memory",
            description: "Persistent notes across conversations",
            icon: BrainCircuit,
            instructions: memoryPrompt,
            // Voice can consume core preferences synchronously. Text chat selects notes
            // after loading the store and before capturing its per-run request context.
            runtimeContext: coreMemory.agentId === agentId ? coreMemory.content : "",
            tools: [],
          }
        : null,
    [memoryEnabled, coreMemory, agentId],
  );

  // --- Combine all providers ---
  const providers = useMemo<ToolProvider[]>(
    () => [repositoryProvider, memoryProvider].filter(Boolean) as ToolProvider[],
    [repositoryProvider, memoryProvider],
  );

  const enabledTools = useMemo(() => agent?.tools || [], [agent?.tools]);

  return {
    providers,
    enabledTools,
  };
}
