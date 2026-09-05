import { BrainCircuit, Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildMemoryRuntimeContext } from "@/features/agent/lib/memoryContext";
import { createMemoryTools } from "@/features/agent/lib/memoryTools";
import memoryPrompt from "@/features/agent/prompts/memory.txt?raw";
import type { Agent } from "@/features/agent/types/agent";
import { createRepositoryTools } from "@/features/repository/lib/repository-tools";
import repositoryInstructions from "@/features/repository/prompts/repository.txt?raw";
import { MCPClient } from "@/features/settings/lib/mcp";
import { getConfig } from "@/shared/config";
import * as opfs from "@/shared/lib/opfs";
import type { ToolProvider } from "@/shared/types/chat";
import { useAgentFiles } from "./useAgentFiles";

export interface AgentProviders {
  /** All tool providers assembled from this agent's config */
  providers: ToolProvider[];
  /** Built-in tool IDs this agent has enabled (e.g. "internet", "canvas") */
  enabledTools: string[];
  /** MCP clients owned by this agent (for lifecycle management) */
  mcpClients: MCPClient[];
}

/**
 * Given an Agent, assembles its ToolProviders:
 * - Repository provider (if files exist)
 * - Memory provider (if enabled)
 * - Bridge MCP clients (for agent.servers)
 * Skills are assembled separately by useSkillsProvider (a single provider across
 * agent / no-agent modes). Also returns the agent.tools list so ToolsProvider
 * knows which built-in tools to activate.
 */
export function useAgentProviders(agent: Agent | null): AgentProviders {
  const agentId = agent?.id || "";
  const { files, queryChunks } = useAgentFiles(agentId);

  // Track MCP clients for agent's bridge servers
  const [mcpClients, setMcpClients] = useState<MCPClient[]>([]);
  const clientsRef = useRef<MCPClient[]>([]);

  const enabledServers = useMemo(() => {
    if (!agent) return [];
    return agent.servers.filter((s) => s.enabled);
  }, [agent]);

  // Track server configs to detect edits (URL, headers, etc.)
  const serverConfigRef = useRef<Map<string, string>>(new Map());

  // Create/update MCP clients when enabled servers change
  useEffect(() => {
    const newIds = new Set(enabledServers.map((s) => s.id));

    // Build config fingerprints to detect property changes
    const newConfigs = new Map(enabledServers.map((s) => [s.id, JSON.stringify({ url: s.url, headers: s.headers })]));

    // Identify servers whose config changed (edited URL/headers)
    const changedIds = new Set(
      enabledServers.filter((s) => serverConfigRef.current.get(s.id) !== newConfigs.get(s.id)).map((s) => s.id),
    );

    const needsUpdate =
      changedIds.size > 0 ||
      clientsRef.current.length !== enabledServers.length ||
      clientsRef.current.some((c) => !newIds.has(c.id));

    if (needsUpdate) {
      // Disconnect removed or changed clients
      const staleClients = clientsRef.current.filter((c) => !newIds.has(c.id) || changedIds.has(c.id));
      staleClients.forEach((client) => {
        client.disconnect().catch(console.error);
      });

      // Create new clients array, reusing unchanged existing clients
      const newClients = enabledServers.map((server) => {
        if (!changedIds.has(server.id)) {
          const existing = clientsRef.current.find((c) => c.id === server.id);
          if (existing) return existing;
        }
        return new MCPClient(server.id, server.url, server.name, server.description, server.headers, server.icon);
      });

      clientsRef.current = newClients;
      serverConfigRef.current = newConfigs;
      setMcpClients(newClients);
    }
  }, [enabledServers]);

  // Cleanup on unmount
  useEffect(() => {
    const clients = clientsRef;
    return () => {
      clients.current.forEach((client) => {
        client.disconnect().catch(console.error);
      });
    };
  }, []);

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
  const config = getConfig();
  const memoryEnabled = !!config.memory && !!agent?.memory;
  const [memoryIndex, setMemoryIndex] = useState<string>("");

  // Load (and migrate, if needed) the memory bundle's index when memory is enabled
  useEffect(() => {
    let cancelled = false;
    if (!memoryEnabled) {
      setMemoryIndex("");
      return;
    }

    const loadMemoryIndex = async () => {
      await opfs.ensureMemoryMigrated(agentId);
      const index = await opfs.readMemoryIndex(agentId);
      if (!cancelled) {
        setMemoryIndex(index);
      }
    };

    loadMemoryIndex().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [memoryEnabled, agentId]);

  // Re-read the index when the agent writes/deletes memory mid-conversation
  useEffect(() => {
    if (!memoryEnabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agentId) {
        void opfs.readMemoryIndex(agentId).then(setMemoryIndex);
      }
    };
    window.addEventListener("memory-updated", handler);
    return () => window.removeEventListener("memory-updated", handler);
  }, [memoryEnabled, agentId]);

  const memoryProvider = useMemo<ToolProvider | null>(() => {
    if (!memoryEnabled) return null;

    const tools = createMemoryTools({
      store: opfs.getMemoryStore(agentId),
      onChange: () => window.dispatchEvent(new CustomEvent("memory-updated", { detail: { agentId } })),
    });

    return {
      id: "memory",
      name: "Memory",
      description: "Persistent structured memory across conversations",
      icon: BrainCircuit,
      instructions: memoryPrompt,
      runtimeContext: buildMemoryRuntimeContext(memoryIndex),
      tools,
    };
  }, [memoryEnabled, memoryIndex, agentId]);

  // --- Combine all providers ---
  const providers = useMemo<ToolProvider[]>(
    () => [repositoryProvider, memoryProvider, ...mcpClients].filter(Boolean) as ToolProvider[],
    [repositoryProvider, memoryProvider, mcpClients],
  );

  const enabledTools = useMemo(() => agent?.tools || [], [agent?.tools]);

  return {
    providers,
    enabledTools,
    mcpClients,
  };
}
