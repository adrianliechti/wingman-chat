import { BrainCircuit, Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { deriveTitleFromPath } from "@/features/agent/lib/memoryParser";
import memoryPrompt from "@/features/agent/prompts/memory.txt?raw";
import type { Agent } from "@/features/agent/types/agent";
import { createRepositoryTools } from "@/features/repository/lib/repository-tools";
import repositoryInstructions from "@/features/repository/prompts/repository.txt?raw";
import { MCPClient } from "@/features/settings/lib/mcp";
import { getConfig } from "@/shared/config";
import * as opfs from "@/shared/lib/opfs";
import type { Tool, ToolProvider } from "@/shared/types/chat";
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

    const notifyMemoryUpdated = () => window.dispatchEvent(new CustomEvent("memory-updated", { detail: { agentId } }));

    // Human-friendly label for a memory tool call: the entry's title, falling
    // back to a title derived from its filename (no raw "*.md" in the chat).
    const memoryLabel = (args: Record<string, unknown> | null): string => {
      const title = typeof args?.title === "string" ? args.title.trim() : "";
      if (title) return title;
      const path = typeof args?.path === "string" ? args.path : "";
      return path ? deriveTitleFromPath(path) : "memory";
    };

    const tools: Tool[] = [
      {
        name: "list_memory",
        display: {
          header: () => ({ icon: BrainCircuit, label: "Recalled memory", suppressPreview: true }),
        },
        description:
          "List your persistent memory entries (title, type, tags, last updated) without loading their full content.",
        parameters: { type: "object", properties: {}, required: [] },
        function: async () => {
          const entries = await opfs.listMemoryEntries(agentId);
          return [{ type: "text" as const, text: JSON.stringify(entries) }];
        },
      },
      {
        name: "read_memory",
        display: {
          header: (args) => ({
            icon: BrainCircuit,
            label: `Recalled ${memoryLabel(args)}`,
            suppressPreview: true,
          }),
        },
        description: "Read one memory entry's full frontmatter and body, given a path from list_memory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: 'Memory file path from list_memory, e.g. "project-context.md".' },
          },
          required: ["path"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = args.path as string;
          const doc = await opfs.readMemoryDoc(agentId, path);
          if (!doc) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `No memory entry at ${path}` }) }];
          }
          return [{ type: "text" as const, text: JSON.stringify({ ...doc.frontmatter, body: doc.body }) }];
        },
      },
      {
        name: "write_memory",
        display: {
          header: (args, state) => ({
            icon: BrainCircuit,
            label: state.error
              ? "Couldn't remember"
              : state.running
                ? "Remembering…"
                : `Remembered ${memoryLabel(args)}`,
            suppressPreview: true,
          }),
          input: (args) => {
            const body = typeof args?.body === "string" ? args.body : "";
            return body ? [{ code: body, language: "markdown" }] : [];
          },
        },
        description:
          "Create or update one memory entry. Use an existing path (from list_memory) to update it, or a new path to create one. Max 4KB per entry — split large topics across multiple entries instead of growing one.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                'Filename for this entry, e.g. "project-context.md". Lowercase, hyphenated, ending in ".md".',
            },
            type: {
              type: "string",
              description: 'Category, e.g. "User Preference", "Project Context", "Decision", "Feedback", "Reference".',
            },
            title: { type: "string", description: "Short title for this entry." },
            description: { type: "string", description: "One-line summary, used in the memory index." },
            resource: {
              type: "string",
              description: "Optional canonical URI if this entry describes an external resource.",
            },
            tags: { type: "array", items: { type: "string" }, description: "Optional tags for filtering." },
            body: { type: "string", description: "Full markdown body content for this entry." },
          },
          required: ["path", "type", "title", "body"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = args.path as string;
          const type = args.type as string;
          const title = args.title as string;
          const body = args.body as string;
          if (!path || !type || !title || !body) {
            return [
              { type: "text" as const, text: JSON.stringify({ error: "path, type, title, and body are required" }) },
            ];
          }
          if (!/^[a-z0-9-]+\.md$/.test(path) || path === "index.md" || path === "log.md") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: 'path must be a lowercase, hyphenated "*.md" filename (not index.md/log.md)',
                }),
              },
            ];
          }

          const byteSize = new TextEncoder().encode(body).length;
          const maxBytes = 4 * 1024;
          if (byteSize > maxBytes) {
            return [
              {
                type: "text" as const,
                text: `Error: Entry body is ${Math.round(byteSize / 1024)}KB which exceeds the 4KB-per-entry limit. Split this into multiple entries instead.`,
              },
            ];
          }

          const description = typeof args.description === "string" ? args.description : undefined;
          const resource = typeof args.resource === "string" ? args.resource : undefined;
          const tags = Array.isArray(args.tags)
            ? args.tags.filter((t): t is string => typeof t === "string")
            : undefined;

          await opfs.writeMemoryDoc(agentId, path, { type, title, description, resource, tags }, body);
          notifyMemoryUpdated();

          const entries = await opfs.listMemoryEntries(agentId);
          let response = `Memory entry "${path}" saved.`;
          if (entries.length > 20) {
            response += ` You now have ${entries.length} entries — consider consolidating related ones.`;
          }
          return [{ type: "text" as const, text: response }];
        },
      },
      {
        name: "delete_memory",
        display: {
          header: (args) => ({
            icon: BrainCircuit,
            label: `Forgot ${memoryLabel(args)}`,
            suppressPreview: true,
          }),
        },
        description: "Delete one memory entry that is stale or no longer relevant.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Memory file path from list_memory to delete." },
          },
          required: ["path"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = args.path as string;
          await opfs.deleteMemoryDoc(agentId, path);
          notifyMemoryUpdated();
          return [{ type: "text" as const, text: `Memory entry "${path}" deleted.` }];
        },
      },
    ];

    // Strip the index file's OKF frontmatter (okf_version) before injecting — it's
    // plumbing the model doesn't need; the <memory-index> tag already labels the block.
    const indexBody = memoryIndex.replace(/^---\n[\s\S]*?\n---\n+/, "").trim();
    const indexSection = indexBody ? `\n\n<memory-index>\n${indexBody}\n</memory-index>` : "\n\nNo memories yet.";

    return {
      id: "memory",
      name: "Memory",
      description: "Persistent structured memory across conversations",
      icon: BrainCircuit,
      instructions: memoryPrompt + indexSection,
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
