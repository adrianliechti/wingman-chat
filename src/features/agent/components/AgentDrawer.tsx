import {
  Bot,
  Check,
  ChevronLeft,
  Download,
  Folder,
  List,
  MessageSquare,
  Mic,
  PenLine,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import {
  exportSingleAgentAsZip,
  importAgentsFromLegacyJson,
  importAgentsFromZip,
} from "@/features/settings/lib/agentImportExport";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { FilesSection } from "./FilesSection";
import { InstructionsSection } from "./InstructionsSection";
import { MemorySection } from "./MemorySection";
import { ModelSection } from "./ModelSection";
import { SkillsSection } from "./SkillsSection";
import { ToolsSection } from "./ToolsSection";
import { AgentWizard } from "./wizard/AgentWizard";

// ─── Agent details: sections ───

interface AgentDetailsProps {
  agent: Agent;
  onDelete: () => void;
  onExport: () => void;
}

function AgentDetails({ agent, onDelete, onExport }: AgentDetailsProps) {
  const config = getConfig();

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <ModelSection agent={agent} />
      <InstructionsSection agent={agent} />
      <ToolsSection agent={agent} />
      <SkillsSection agent={agent} />
      {config.repository && <FilesSection agent={agent} />}
      {config.memory && <MemorySection agent={agent} />}
      <div className="shrink-0 px-3 py-3 mt-auto border-t border-neutral-200/60 dark:border-neutral-700/60 flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 border border-neutral-200/80 dark:border-neutral-700/60 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
        >
          <Download size={12} />
          Export
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-500 hover:text-red-600 border border-red-200/80 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Main AgentDrawer component ───

export function AgentDrawer() {
  const { agents, currentAgent, setCurrentAgent, updateAgent, deleteAgent, setShowAgentDrawer } = useAgents();

  // "list" shows the agent list; "details" shows the selected agent's configuration
  const [view, setView] = useState<"list" | "details">(currentAgent ? "details" : "list");

  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const inlineEditInputRef = useRef<HTMLInputElement>(null);

  // Pending file uploads after wizard creation
  const [pendingWizardFiles, setPendingWizardFiles] = useState<File[] | null>(null);
  const { addFile } = useAgentFiles(currentAgent?.id || "");

  // Process pending file uploads when agent becomes current
  useEffect(() => {
    if (!currentAgent || !pendingWizardFiles) return;

    setPendingWizardFiles(null);

    (async () => {
      for (const file of pendingWizardFiles) {
        await addFile(file);
      }
    })();
  }, [currentAgent, addFile, pendingWizardFiles]);

  const handleWizardCreated = useCallback((_agent: Agent, pendingFiles: File[]) => {
    if (pendingFiles.length > 0) {
      setPendingWizardFiles(pendingFiles);
    }
  }, []);

  useEffect(() => {
    if (!inlineEditingId) return;

    const frame = requestAnimationFrame(() => {
      inlineEditInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [inlineEditingId]);

  const startInlineEdit = (agent: Agent) => {
    setInlineEditingId(agent.id);
    setEditingName(agent.name);
  };

  const saveInlineEdit = () => {
    if (inlineEditingId && editingName.trim()) {
      updateAgent(inlineEditingId, { name: editingName.trim() });
      setInlineEditingId(null);
      setEditingName("");
    }
  };

  const cancelInlineEdit = () => {
    setInlineEditingId(null);
    setEditingName("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      saveInlineEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineEdit();
    }
  };

  const handleAgentSelect = (agent: Agent | null) => {
    setCurrentAgent(agent);
    if (!agent) {
      setShowAgentDrawer(false);
    } else {
      setView("details");
    }
  };

  const handleListSelect = (agent: Agent) => {
    cancelInlineEdit();
    setCurrentAgent(agent);
    setView("details");
  };

  const openWizard = () => {
    setWizardOpen(true);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-neutral-50 dark:bg-neutral-950 pt-2 md:pt-0">
      {/* Panel header: back (details only) + inline agent selector + close */}
      <div className="shrink-0 h-12 md:h-10 flex items-center px-3 gap-2">
        {view === "list" ? (
          <>
            <span className="flex-1 min-w-0 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate">
              Agents
            </span>
            <button
              type="button"
              onClick={() => setShowAgentDrawer(false)}
              className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
              title="Close"
              aria-label="Close agent drawer"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setView("list")}
              className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
              title="Back to agents"
              aria-label="Back to agents"
            >
              <Bot size={15} />
            </button>
            {inlineEditingId === currentAgent?.id ? (
              <input
                ref={inlineEditInputRef}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleInputKeyDown}
                className="flex-1 min-w-0 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 bg-transparent border-b border-neutral-400 dark:border-neutral-500 outline-none truncate"
              />
            ) : (
              <button
                type="button"
                onClick={() => currentAgent && startInlineEdit(currentAgent)}
                className="flex-1 min-w-0 text-left text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate hover:opacity-70 transition-opacity"
                title="Click to rename"
              >
                {currentAgent?.name ?? "Agent"}
              </button>
            )}
            {inlineEditingId === currentAgent?.id ? (
              <>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={saveInlineEdit}
                  className="shrink-0 p-1 rounded-md text-green-500 hover:text-green-600 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                  title="Save"
                  aria-label="Save agent name"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={cancelInlineEdit}
                  className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-red-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                  title="Cancel"
                  aria-label="Cancel rename"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowAgentDrawer(false)}
                className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                title="Close"
                aria-label="Close agent drawer"
              >
                <X size={15} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Agent list or details */}
      {view === "list" ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          {agents.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col flex-1 items-center justify-center p-6 text-center overflow-auto">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 flex items-center justify-center mb-4">
                <Bot size={24} className="text-neutral-400 dark:text-neutral-500" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">No agents yet</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5 max-w-xs leading-relaxed">
                Agents bundle instructions, files, skills, and tools into a reusable configuration.
              </p>
              <div className="text-xs text-neutral-400 dark:text-neutral-500 space-y-2 mb-5 text-left">
                <div className="flex items-center gap-2">
                  <PenLine size={12} className="shrink-0 text-neutral-400" />
                  <span>Custom instructions</span>
                </div>
                <div className="flex items-center gap-2">
                  <Folder size={12} className="shrink-0 text-neutral-400" />
                  <span>Upload reference documents</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles size={12} className="shrink-0 text-neutral-400" />
                  <span>Select specialized skills</span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare size={12} className="shrink-0 text-neutral-400" />
                  <span>Configure tools &amp; MCP servers</span>
                </div>
              </div>
              <button
                type="button"
                onClick={openWizard}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
              >
                <Plus size={12} />
                Create Agent
              </button>
            </div>
          ) : (
            /* Agent list */
            <>
              <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
                {agents
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleListSelect(agent)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                        "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60",
                        currentAgent?.id === agent.id && "bg-neutral-100/60 dark:bg-neutral-800/40",
                      )}
                    >
                      <div className="shrink-0 w-8 h-8 rounded-xl bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
                        {agent.model === "realtime" ? (
                          <Mic size={15} className="text-neutral-600 dark:text-neutral-300" />
                        ) : (
                          <Bot size={15} className="text-neutral-600 dark:text-neutral-300" />
                        )}
                      </div>
                      <span className="flex-1 min-w-0 text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                        {agent.name}
                      </span>
                    </button>
                  ))}
              </div>
              <div className="shrink-0 px-3 py-2.5 border-t border-neutral-200/60 dark:border-neutral-700/60 flex items-center gap-2">
                <button
                  type="button"
                  onClick={openWizard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
                >
                  <Plus size={12} />
                  New Agent
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".zip,.json";
                    input.multiple = false;
                    input.onchange = async (event) => {
                      const file = (event.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      const isZip = file.name.endsWith(".zip");
                      if (isZip) {
                        if (
                          !window.confirm(
                            "Import agents from ZIP? This will merge with your existing agents and skills.",
                          )
                        )
                          return;
                        try {
                          await importAgentsFromZip(file);
                          alert("Agents imported successfully! Please refresh the page to see the changes.");
                          window.location.reload();
                        } catch (error) {
                          console.error("Failed to import agents:", error);
                          alert("Failed to import agents. Please check the file and try again.");
                        }
                      } else {
                        try {
                          const jsonData = await file.text();
                          const parsed = JSON.parse(jsonData);
                          const count = parsed.repositories?.length ?? 0;
                          if (!count) {
                            alert("Invalid import file.");
                            return;
                          }
                          if (
                            !window.confirm(`Import ${count} legacy repositor${count === 1 ? "y" : "ies"} as agents?`)
                          )
                            return;
                          const result = await importAgentsFromLegacyJson(jsonData);
                          alert(
                            `Imported ${result.imported} agent${result.imported === 1 ? "" : "s"}. Please refresh to see changes.`,
                          );
                          window.location.reload();
                        } catch (error) {
                          console.error("Failed to import agents:", error);
                          alert("Failed to import. Please check the file format and try again.");
                        }
                      }
                    };
                    input.click();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 border border-neutral-200/80 dark:border-neutral-700/60 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
                >
                  <Upload size={12} />
                  Import
                </button>
              </div>
            </>
          )}
        </div>
      ) : /* Details view */
      currentAgent ? (
        <AgentDetails
          key={currentAgent.id}
          agent={currentAgent}
          onExport={() => exportSingleAgentAsZip(currentAgent.id)}
          onDelete={() => {
            if (!window.confirm(`Delete "${currentAgent.name}"? This cannot be undone.`)) return;
            deleteAgent(currentAgent.id);
            handleAgentSelect(null);
          }}
        />
      ) : null}

      <AgentWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={handleWizardCreated} />
    </div>
  );
}
