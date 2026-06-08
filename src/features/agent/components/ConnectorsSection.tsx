import { AlertTriangle, Loader2, Pencil, Plus, Server, ToggleLeft, ToggleRight, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { BridgeEditor } from "@/features/agent/components/BridgeEditor";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { ProviderState } from "@/shared/types/chat";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { Section } from "./Section";

interface ConnectorsSectionProps {
  agent: Agent;
}

export function ConnectorsSection({ agent }: ConnectorsSectionProps) {
  const { updateAgent, addServer, updateServer, removeServer, toggleServer } = useAgents();
  const { providers, getProviderState, setProviderEnabled } = useToolsContext();

  const [bridgeEditorOpen, setBridgeEditorOpen] = useState(false);
  const [editingBridge, setEditingBridge] = useState<BridgeServer | null>(null);

  // Agent-internal provider IDs to exclude (handled elsewhere in the drawer)
  const agentInternalIds = useMemo(() => {
    const ids = new Set(["repository", "skills", "memory"]);
    for (const s of agent.servers) ids.add(s.id);
    return ids;
  }, [agent.servers]);

  // Global tools: built-in providers + config MCPs (everything not agent-internal)
  const availableTools = useMemo(() => {
    return providers
      .filter((p) => !agentInternalIds.has(p.id) && p.id !== "artifacts")
      .map((p) => ({
        id: p.id,
        label: p.name,
        description: p.description,
        Icon: p.icon,
      }));
  }, [providers, agentInternalIds]);

  const agentToolIds = useMemo(() => new Set(agent.tools || []), [agent.tools]);

  const toggleTool = (toolId: string) => {
    const current = agent.tools || [];
    const next = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId];
    updateAgent(agent.id, { tools: next });
  };

  const handleNewBridge = () => {
    setEditingBridge(null);
    setBridgeEditorOpen(true);
  };

  const handleEditBridge = (server: BridgeServer) => {
    setEditingBridge(server);
    setBridgeEditorOpen(true);
  };

  const handleSaveBridge = (data: Omit<BridgeServer, "id">) => {
    if (editingBridge) {
      updateServer(agent.id, editingBridge.id, data);
    } else {
      addServer(agent.id, data);
    }
  };

  const handleDeleteBridge = (server: BridgeServer) => {
    removeServer(agent.id, server.id);
  };

  return (
    <>
      <BridgeEditor
        isOpen={bridgeEditorOpen}
        onClose={() => setBridgeEditorOpen(false)}
        onSave={handleSaveBridge}
        onDelete={editingBridge ? () => handleDeleteBridge(editingBridge) : undefined}
        bridge={editingBridge}
      />

      <Section
        title="Connectors"
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            onClick={handleNewBridge}
            className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            <Plus size={12} /> Add MCP
          </button>
        }
      >
        <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
          {availableTools.map((tool) => {
            const enabled = agentToolIds.has(tool.id);
            return (
              <div key={tool.id} className="flex items-center gap-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleTool(tool.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <Tooltip
                    content={tool.description ?? tool.label}
                    side="left"
                    className="inline-flex items-center gap-2 min-w-0"
                  >
                    <div
                      className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!enabled ? "opacity-40" : ""}`}
                    >
                      {!tool.Icon ? (
                        <Wrench size={13} />
                      ) : typeof tool.Icon === "string" ? (
                        <McpProviderIcon src={tool.Icon} size={13} />
                      ) : (
                        <tool.Icon width={13} height={13} />
                      )}
                    </div>
                    <span
                      className={`min-w-0 text-xs truncate ${enabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
                    >
                      {tool.label}
                    </span>
                  </Tooltip>
                </button>
                <button
                  type="button"
                  onClick={() => toggleTool(tool.id)}
                  className={`shrink-0 ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
                >
                  {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
            );
          })}

          {agent.servers.map((server) => {
            const state = server.enabled ? getProviderState(server.id) : ProviderState.Disconnected;
            const liveIcon = providers.find((p) => p.id === server.id)?.icon;
            const resolvedIcon =
              typeof server.icon === "string" && server.icon
                ? server.icon
                : typeof liveIcon === "string"
                  ? liveIcon
                  : server.url
                    ? new URL("icon", server.url.endsWith("/") ? server.url : `${server.url}/`).href
                    : undefined;

            return (
              <div key={server.id} className="group flex items-center gap-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleServer(agent.id, server.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <Tooltip
                    content={server.description || server.url}
                    side="left"
                    className="inline-flex items-center gap-2 min-w-0"
                  >
                    <div
                      className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!server.enabled ? "opacity-40" : ""}`}
                    >
                      {state === ProviderState.Initializing ? (
                        <Loader2 size={13} className="animate-spin" aria-label="Connecting…" />
                      ) : state === ProviderState.Failed ? (
                        <AlertTriangle size={13} className="text-amber-500" />
                      ) : resolvedIcon ? (
                        <McpProviderIcon src={resolvedIcon} size={13} className="object-contain" />
                      ) : (
                        <Server size={13} />
                      )}
                    </div>
                    <span
                      className={`min-w-0 text-xs truncate ${server.enabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
                    >
                      {server.name}
                    </span>
                  </Tooltip>
                </button>
                <button
                  type="button"
                  onClick={() => handleEditBridge(server)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-opacity"
                  title="Edit server"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (state === ProviderState.Failed) {
                      setProviderEnabled(server.id, true);
                    } else {
                      toggleServer(agent.id, server.id);
                    }
                  }}
                  className={`shrink-0 ${server.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
                  title={
                    state === ProviderState.Failed
                      ? "Connection failed — click to retry"
                      : server.enabled
                        ? "Enabled (click to disable)"
                        : "Disabled (click to enable)"
                  }
                >
                  {server.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
