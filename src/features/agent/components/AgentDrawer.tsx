import {
  Bot,
  Check,
  ChevronDown,
  Download,
  Edit,
  Folder,
  MessageSquare,
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
}

function AgentDetails({ agent }: AgentDetailsProps) {
  const config = getConfig();

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <ModelSection agent={agent} />
      <InstructionsSection agent={agent} />

      {config.repository && <FilesSection agent={agent} />}

      <SkillsSection agent={agent} />
      <ToolsSection agent={agent} />
      {config.memory && <MemorySection agent={agent} />}
    </div>
  );
}

// ─── Main AgentDrawer component ───

export function AgentDrawer() {
  const { agents, currentAgent, setCurrentAgent, updateAgent, deleteAgent, setShowAgentDrawer } = useAgents();

  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (!inlineEditingId) {
          setIsDropdownOpen(false);
        }
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen, inlineEditingId]);

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
      setIsDropdownOpen(false);
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
    if (!agent) setShowAgentDrawer(false);
    setIsDropdownOpen(false);
  };

  const openWizard = () => {
    setIsDropdownOpen(false);
    setWizardOpen(true);
  };

  return (
    <div className="h-full flex flex-col md:rounded-lg overflow-hidden transition-all duration-150 ease-linear bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md md:border md:border-neutral-200/60 md:dark:border-neutral-700/60 md:shadow-sm">
      {/* Header with Agent Selector */}
      <div className="px-3 py-3 border-b border-neutral-200/60 dark:border-neutral-700/60">
        <div className="relative w-full" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="relative w-full rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-10 text-left shadow-sm border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg"
          >
            <span className="flex items-center gap-2">
              <Bot size={16} className="text-neutral-600 dark:text-neutral-300" />
              <span className="block truncate text-neutral-900 dark:text-neutral-100 font-medium">
                {currentAgent?.name || "None"}
              </span>
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown
                size={16}
                className={`text-neutral-400 dark:text-neutral-300 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>

          {isDropdownOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 backdrop-blur-xl">
              {/* None Option */}
              <button
                type="button"
                className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 flex items-center gap-2 w-full"
                onClick={() => handleAgentSelect(null)}
              >
                <X size={16} className="text-neutral-600 dark:text-neutral-300 shrink-0" />
                <span className={`block truncate text-sm ${!currentAgent ? "font-semibold" : "font-normal"}`}>
                  None
                </span>
              </button>

              {/* Create New */}
              <div className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openWizard();
                  }}
                  className="flex items-center gap-2 w-full text-sm text-neutral-600 dark:text-neutral-400 font-medium"
                >
                  <Plus size={16} /> Create New Agent
                </button>
              </div>

              {/* Existing Agents */}
              {agents
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((agent) => {
                  const isCurrent = currentAgent?.id === agent.id;
                  const isEditing = inlineEditingId === agent.id;
                  return (
                    <div
                      key={`${agent.id}-${agent.name}`}
                      className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Bot size={16} className="text-neutral-600 dark:text-neutral-400 shrink-0" />
                        {isEditing ? (
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              ref={inlineEditInputRef}
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={handleInputKeyDown}
                              className="flex-1 text-sm bg-transparent border-0 border-b border-slate-500 rounded-none px-1 py-0 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-slate-600 dark:focus:border-slate-400"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveInlineEdit();
                              }}
                              className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors shrink-0"
                              title="Save"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelInlineEdit();
                              }}
                              className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors shrink-0"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAgentSelect(agent)}
                            className="flex items-center gap-2 flex-1 text-left min-w-0"
                          >
                            <span className={`block truncate text-sm ${isCurrent ? "font-semibold" : "font-normal"}`}>
                              {agent.name}
                            </span>
                          </button>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportSingleAgentAsZip(agent.id);
                            }}
                            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-400 rounded transition-colors"
                            title="Export agent"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startInlineEdit(agent);
                            }}
                            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-400 rounded transition-colors"
                            title="Edit name"
                          >
                            <Edit size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete agent "${agent.name}"?`)) {
                                deleteAgent(agent.id);
                                if (isCurrent) setCurrentAgent(null);
                              }
                            }}
                            className="p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                            title="Delete agent"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Agent Details */}
      {currentAgent ? (
        <AgentDetails key={currentAgent.id} agent={currentAgent} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <Bot size={48} className="text-neutral-300 dark:text-neutral-600 mb-4" />
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
            {agents.length === 0 ? "Create an Agent" : "No Agent Selected"}
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 max-w-xs">
            {agents.length === 0
              ? "Agents bundle instructions, files, skills, and tools into a reusable configuration."
              : "Select an agent from the dropdown above to configure it."}
          </p>
          {agents.length === 0 && (
            <div className="text-xs text-neutral-500 dark:text-neutral-500 space-y-2">
              <div className="flex items-center gap-2">
                <PenLine size={12} className="shrink-0" />
                <span>Custom instructions</span>
              </div>
              <div className="flex items-center gap-2">
                <Folder size={12} className="shrink-0" />
                <span>Upload reference documents</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="shrink-0" />
                <span>Select specialized skills</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare size={12} className="shrink-0" />
                <span>Configure tools & MCP servers</span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-6">
            <button
              type="button"
              onClick={openWizard}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <Plus size={12} />
              Create Agent
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
                      !window.confirm("Import agents from ZIP? This will merge with your existing agents and skills.")
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
                      if (!window.confirm(`Import ${count} legacy repositor${count === 1 ? "y" : "ies"} as agents?`))
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
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <Upload size={12} />
              Import Agent(s)
            </button>
          </div>
        </div>
      )}

      <AgentWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={handleWizardCreated} />
    </div>
  );
}
