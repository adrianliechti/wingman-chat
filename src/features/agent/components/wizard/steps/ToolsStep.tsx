import { useState, useMemo, type Dispatch } from "react";
import { ToggleLeft, ToggleRight, Wrench, Plus, X, Server } from "lucide-react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { BridgeEditor } from "@/features/agent/components/BridgeEditor";
import type { BridgeServer } from "@/features/agent/types/agent";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface ToolsStepProps {
  selectedTools: string[];
  servers: Omit<BridgeServer, "id">[];
  dispatch: Dispatch<WizardAction>;
}

const AGENT_INTERNAL_IDS = new Set(["repository", "skills", "memory"]);

export function ToolsStep({ selectedTools, servers, dispatch }: ToolsStepProps) {
  const { providers } = useToolsContext();
  const [bridgeEditorOpen, setBridgeEditorOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedTools), [selectedTools]);

  const availableTools = useMemo(
    () =>
      providers
        .filter((p) => !AGENT_INTERNAL_IDS.has(p.id))
        .map((p) => ({ id: p.id, label: p.name, description: p.description, Icon: p.icon })),
    [providers],
  );

  return (
    <div className="space-y-3">
      <StepHeader
        title="Enable tools"
        description="Tools let your agent search the web, generate images, and connect to external services. Toggle on what you need, or skip this — tools can be changed later."
      />

      <div className="space-y-0.5">
        {availableTools.map((tool) => {
          const isEnabled = selectedSet.has(tool.id);
          return (
            <div key={tool.id} className="flex items-center gap-2 py-1.5">
              <span className="text-neutral-600 dark:text-neutral-400">
                {!tool.Icon ? (
                  <Wrench size={16} />
                ) : typeof tool.Icon === "string" ? (
                  <span
                    className="bg-current inline-block"
                    style={{
                      width: 16,
                      height: 16,
                      maskImage: `url(${tool.Icon})`,
                      WebkitMaskImage: `url(${tool.Icon})`,
                      maskSize: "contain",
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                    }}
                  />
                ) : (
                  <tool.Icon width={16} height={16} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{tool.label}</div>
                {tool.description && (
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                    {tool.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_TOOL", id: tool.id })}
                className={`shrink-0 ${isEnabled ? "text-blue-600 dark:text-blue-400" : "text-neutral-400 dark:text-neutral-500"}`}
              >
                {isEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Pending MCP servers */}
      {servers.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t border-neutral-200/40 dark:border-neutral-700/40">
          {servers.map((server, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <Server size={14} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{server.name}</div>
                <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">{server.url}</div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "REMOVE_SERVER", index: i })}
                className="shrink-0 p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setBridgeEditorOpen(true)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
      >
        <Plus size={12} /> Add MCP Server
      </button>

      <BridgeEditor
        isOpen={bridgeEditorOpen}
        onClose={() => setBridgeEditorOpen(false)}
        onSave={(data) => dispatch({ type: "ADD_SERVER", server: data })}
        bridge={null}
      />
    </div>
  );
}
