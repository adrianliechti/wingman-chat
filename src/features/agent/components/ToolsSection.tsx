import { useState, useMemo } from 'react';
import {
  Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Server, Wrench, AlertTriangle, Loader2,
} from 'lucide-react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import { useToolsContext } from '@/features/tools/hooks/useToolsContext';
import { BridgeEditor } from '@/features/agent/components/BridgeEditor';
import type { Agent, BridgeServer } from '@/features/agent/types/agent';
import { ProviderState } from '@/shared/types/chat';
import { Section } from './Section';

interface ToolsSectionProps {
  agent: Agent;
}

export function ToolsSection({ agent }: ToolsSectionProps) {
  const { updateAgent, addServer, updateServer, removeServer, toggleServer } = useAgents();
  const { providers, getProviderState, setProviderEnabled } = useToolsContext();

  const [bridgeEditorOpen, setBridgeEditorOpen] = useState(false);
  const [editingBridge, setEditingBridge] = useState<BridgeServer | null>(null);

  // Agent-internal provider IDs to exclude (handled elsewhere in the drawer)
  const agentInternalIds = useMemo(() => {
    const ids = new Set(['repository', 'skills', 'memory']);
    for (const s of agent.servers) ids.add(s.id);
    return ids;
  }, [agent.servers]);

  // Global tools: built-in providers + config MCPs (everything not agent-internal)
  const availableTools = useMemo(() => {
    return providers
      .filter(p => !agentInternalIds.has(p.id))
      .map(p => ({
        id: p.id,
        label: p.name,
        description: p.description,
        Icon: p.icon,
      }));
  }, [providers, agentInternalIds]);

  const agentToolIds = useMemo(() => new Set(agent.tools || []), [agent.tools]);

  const toggleTool = (toolId: string) => {
    const current = agent.tools || [];
    const next = current.includes(toolId)
      ? current.filter(id => id !== toolId)
      : [...current, toolId];
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

  const handleSaveBridge = (data: Omit<BridgeServer, 'id'>) => {
    if (editingBridge) {
      updateServer(agent.id, editingBridge.id, data);
    } else {
      addServer(agent.id, data);
    }
  };

  const handleDeleteBridge = (server: BridgeServer) => {
    if (window.confirm(`Delete server "${server.name}"?`)) {
      removeServer(agent.id, server.id);
    }
  };

  return (
    <>
      <BridgeEditor
        isOpen={bridgeEditorOpen}
        onClose={() => setBridgeEditorOpen(false)}
        onSave={handleSaveBridge}
        bridge={editingBridge}
      />

      <Section
        title="Tools"
        icon={<Wrench size={16} />}
        isOpen={true}
        collapsible={false}
      >
        <div className="space-y-3">
          {/* Available tools */}
          {availableTools.length > 0 && (
            <div className="space-y-1.5">
              {availableTools.map(tool => (
                <div key={tool.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/30 dark:bg-neutral-900/40 border border-neutral-200/40 dark:border-neutral-700/40">
                  <button
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    className={`shrink-0 ${agentToolIds.has(tool.id) ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                    title={agentToolIds.has(tool.id) ? 'Enabled (click to disable)' : 'Disabled (click to enable)'}
                  >
                    {agentToolIds.has(tool.id) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                  </button>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {!tool.Icon ? (
                      <Wrench size={16} />
                    ) : typeof tool.Icon === 'string' ? (
                      <span className="bg-current inline-block" style={{ width: 16, height: 16, maskImage: `url(${tool.Icon})`, WebkitMaskImage: `url(${tool.Icon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
                    ) : (
                      <tool.Icon width={16} height={16} />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{tool.label}</div>
                    {tool.description && (
                      <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">{tool.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* MCP Servers */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-medium">MCP Servers</div>
              <button
                type="button"
                onClick={handleNewBridge}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-0.5"
              >
                <Plus size={12} /> Add
              </button>
            </div>
            {agent.servers.length > 0 ? (
              agent.servers.map(server => {
                const state = server.enabled ? getProviderState(server.id) : ProviderState.Disconnected;
                return (
                <div key={server.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/30 dark:bg-neutral-900/40 border border-neutral-200/40 dark:border-neutral-700/40 group">
                  {state === ProviderState.Failed ? (
                    <button type="button" onClick={() => setProviderEnabled(server.id, true)} className="shrink-0 text-amber-500 hover:text-amber-600" title="Connection failed — click to retry">
                      <AlertTriangle size={16} />
                    </button>
                  ) : state === ProviderState.Initializing ? (
                    <Loader2 size={16} className="shrink-0 text-neutral-400 animate-spin" aria-label="Connecting…" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleServer(agent.id, server.id)}
                      className={`shrink-0 ${server.enabled ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                    >
                      {server.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                  )}
                  {server.icon
                    ? <span className="shrink-0 bg-current inline-block" style={{ width: 14, height: 14, maskImage: `url(${server.icon})`, WebkitMaskImage: `url(${server.icon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
                    : <Server size={14} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{server.name}</div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">{server.url}</div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" onClick={() => handleEditBridge(server)} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors" title="Edit">
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => handleDeleteBridge(server)} className="p-1 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors" title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                );
              })
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-1">
                No MCP servers configured.
              </p>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
