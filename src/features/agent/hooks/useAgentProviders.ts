import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import type { Agent } from "@/features/agent/types/agent";
import { useAgentFiles } from "./useAgentFiles";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { MCPClient } from "@/features/settings/lib/mcp";
import type { Tool, ToolProvider } from "@/shared/types/chat";

import { createRepositoryTools } from "@/features/repository/lib/repository-tools";
import repositoryInstructions from "@/features/repository/prompts/repository.txt?raw";
import skillsPrompt from "@/features/skills/prompts/skills.txt?raw";
import memoryPrompt from "@/features/agent/prompts/memory.txt?raw";
import * as opfs from "@/shared/lib/opfs";
import { getConfig } from "@/shared/config";
import { Package, Sparkles, BrainCircuit } from "lucide-react";

export interface AgentProviders {
  /** All tool providers assembled from this agent's config */
  providers: ToolProvider[];
  /** Built-in tool IDs this agent has enabled (e.g. "internet", "renderer") */
  enabledTools: string[];
  /** MCP clients owned by this agent (for lifecycle management) */
  mcpClients: MCPClient[];
}

/**
 * Given an Agent, assembles all its ToolProviders:
 * - Repository provider (if files exist)
 * - Skills provider (filtered to agent.skills IDs from global library)
 * - Bridge MCP clients (for agent.servers)
 * Also returns the agent.tools list for ToolsProvider to know which built-in tools to activate.
 */
export function useAgentProviders(agent: Agent | null): AgentProviders {
  const agentId = agent?.id || "";
  const { files, queryChunks } = useAgentFiles(agentId);
  const { skills: allSkills, getSkill } = useSkills();

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
    const newConfigs = new Map(
      enabledServers.map((s) => [s.id, JSON.stringify({ url: s.url, headers: s.headers })]),
    );

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

    const tools = createRepositoryTools(files, queryChunks);

    return {
      id: "repository",
      name: "Repository",
      description: "File access tools for your repository",
      icon: Package,
      instructions: repositoryInstructions || undefined,
      tools,
    };
  }, [agent, files, queryChunks]);

  // --- Skills provider ---
  const agentSkillIds = useMemo(() => new Set(agent?.skills || []), [agent?.skills]);

  const enabledSkills = useMemo(() => {
    if (!agent || agentSkillIds.size === 0) return [];
    return allSkills.filter((s) => agentSkillIds.has(s.name));
  }, [agent, allSkills, agentSkillIds]);

  const getSkillTools = useCallback((): Tool[] => {
    if (enabledSkills.length === 0) return [];
    return [
      {
        name: "read_skill",
        description: "Read the full content and instructions of an available skill.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the skill to read.",
            },
          },
          required: ["name"],
        },
        function: async (args: Record<string, unknown>) => {
          const skillName = args.name as string;
          if (!skillName) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "No skill name provided" }) }];
          }
          const skill = getSkill(skillName);
          if (!skill) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skillName}" not found` }) }];
          }
          if (!agentSkillIds.has(skill.name)) {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Skill "${skillName}" is not enabled for this agent` }),
              },
            ];
          }
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                name: skill.name,
                description: skill.description,
                instructions: skill.content,
              }),
            },
          ];
        },
      },
    ];
  }, [enabledSkills, getSkill, agentSkillIds]);

  const skillsProvider = useMemo<ToolProvider | null>(() => {
    if (enabledSkills.length === 0) return null;

    const tools = getSkillTools();
    const skillsXml = enabledSkills
      .map(
        (skill) =>
          `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description}</description>\n  </skill>`,
      )
      .join("\n");

    const instructions = skillsPrompt.replace("{skillsXml}", skillsXml);

    return {
      id: "skills",
      name: "Skills",
      description: "Specialized agent skills",
      icon: Sparkles,
      instructions: instructions || undefined,
      tools,
    };
  }, [enabledSkills, getSkillTools]);

  // --- Memory provider ---
  const config = getConfig();
  const memoryEnabled = !!config.memory && !!agent?.memory;
  const memoryPath = memoryEnabled ? `agents/${agentId}/MEMORY.md` : "";
  const [memoryContent, setMemoryContent] = useState<string>("");

  // Load memory content from OPFS when memory is enabled
  useEffect(() => {
    let cancelled = false;

    const loadMemoryContent = async () => {
      const text = memoryPath ? await opfs.readText(memoryPath) : "";
      if (!cancelled) {
        setMemoryContent(text || "");
      }
    };

    loadMemoryContent().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [memoryPath]);

  // Re-read memory when the agent writes to it mid-conversation
  useEffect(() => {
    if (!memoryEnabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agentId) {
        opfs.readText(memoryPath).then((text) => setMemoryContent(text || ""));
      }
    };
    window.addEventListener("memory-updated", handler);
    return () => window.removeEventListener("memory-updated", handler);
  }, [memoryEnabled, agentId, memoryPath]);

  const getMemoryTools = useCallback((): Tool[] => {
    if (!memoryEnabled) return [];
    const agentPath = `agents/${agentId}`;
    return [
      {
        name: "write_memory",
        description: "Write/update your persistent memory. This replaces the entire memory content.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The full memory content to save (markdown format).",
            },
          },
          required: ["content"],
        },
        function: async (args: Record<string, unknown>) => {
          const content = args.content as string;
          if (!content) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "No content provided" }) }];
          }
          await opfs.writeText(`${agentPath}/MEMORY.md`, content);
          window.dispatchEvent(new CustomEvent("memory-updated", { detail: { agentId } }));
          return [{ type: "text" as const, text: "Memory updated successfully." }];
        },
      },
    ];
  }, [memoryEnabled, agentId]);

  const memoryProvider = useMemo<ToolProvider | null>(() => {
    if (!memoryEnabled) return null;

    const tools = getMemoryTools();
    const memorySection = memoryContent.trim()
      ? `\n\n<memory>\n${memoryContent.trim()}\n</memory>`
      : "\n\nNo memories yet.";

    return {
      id: "memory",
      name: "Memory",
      description: "Persistent memory across conversations",
      icon: BrainCircuit,
      instructions: (memoryPrompt || "") + memorySection,
      tools,
    };
  }, [memoryEnabled, getMemoryTools, memoryContent]);

  // --- Combine all providers ---
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    if (repositoryProvider) list.push(repositoryProvider);
    if (skillsProvider) list.push(skillsProvider);
    if (memoryProvider) list.push(memoryProvider);
    list.push(...mcpClients);
    return list;
  }, [repositoryProvider, skillsProvider, memoryProvider, mcpClients]);

  const enabledTools = useMemo(() => agent?.tools || [], [agent?.tools]);

  return {
    providers,
    enabledTools,
    mcpClients,
  };
}
