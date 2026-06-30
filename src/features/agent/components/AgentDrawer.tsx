import {
  Bot,
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderCog,
  MessageSquare,
  Mic,
  MoreVertical,
  PenLine,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentFiles } from "@/features/agent/hooks/useAgentFiles";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { exportSingleAgentAsZip, triggerAgentImport } from "@/features/settings/lib/agentImportExport";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
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
      <ToolsSection agent={agent} />
      <SkillsSection agent={agent} />
      {config.repository && <FilesSection agent={agent} />}
      {config.memory && <MemorySection agent={agent} />}
    </div>
  );
}

// ─── Main AgentDrawer component ───

export function AgentDrawer() {
  const { agents, currentAgent, setCurrentAgent, updateAgent, deleteAgent, setShowAgentDrawer, agentDrawerView } =
    useAgents();
  const config = getConfig();

  // "list" shows the agent list; "details" shows the selected agent's configuration
  const [view, setView] = useState<"list" | "details">("list");

  // Sync view whenever the drawer is (re-)opened
  useEffect(() => {
    setView(agentDrawerView);
  }, [agentDrawerView]);

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

    void (async () => {
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
      <div className="shrink-0 h-12 md:h-10 flex items-center px-4 gap-2">
        {view === "list" ? (
          <>
            <span className="flex-1 min-w-0 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate">
              Agents
            </span>
            {agents.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={openWizard}
                  className="shrink-0 flex items-center gap-1 mr-2 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  title="Create a new agent"
                >
                  <Plus size={12} />
                  New
                </button>
                <button
                  type="button"
                  onClick={triggerAgentImport}
                  className="shrink-0 flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  title="Import an agent"
                >
                  <Upload size={12} />
                  Import
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate">
              <DropdownMenu
                anchor="bottom start"
                panelClassName="min-w-48 flex flex-col"
                trigger={
                  <MenuButton className="inline-flex items-center gap-1 text-left text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate hover:opacity-70 transition-opacity max-w-full">
                    <span className="truncate">{currentAgent?.name ?? "Agent"}</span>
                    <ChevronDown size={13} className="shrink-0 opacity-60" />
                  </MenuButton>
                }
              >
                <DropdownMenuItem
                  icon={<X size={13} />}
                  onClick={() => {
                    setCurrentAgent(null);
                    setShowAgentDrawer(false);
                  }}
                >
                  No agent
                </DropdownMenuItem>
                <DropdownMenuDivider />
                <div className="overflow-y-auto max-h-80">
                  {agents
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((agent) => (
                      <DropdownMenuItem
                        key={agent.id}
                        icon={agent.model === "realtime" ? <Mic size={13} /> : <Bot size={13} />}
                        selected={currentAgent?.id === agent.id}
                        onClick={() => {
                          setCurrentAgent(agent);
                          setView("details");
                        }}
                      >
                        {agent.name}
                      </DropdownMenuItem>
                    ))}
                </div>
                <DropdownMenuDivider />
                <DropdownMenuItem icon={<FolderCog size={13} />} onClick={() => setView("list")}>
                  Manage agents
                </DropdownMenuItem>
              </DropdownMenu>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openWizard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-transparent bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
                >
                  <Plus size={12} />
                  Create Agent
                </button>
                <button
                  type="button"
                  onClick={triggerAgentImport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 border border-neutral-200/80 dark:border-neutral-700/60 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
                >
                  <Upload size={12} />
                  Import
                </button>
              </div>
            </div>
          ) : (
            /* Agent list */
            <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
              {agents
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((agent) => {
                  const isActive = currentAgent?.id === agent.id;
                  const isRenaming = inlineEditingId === agent.id && view === "list";
                  return (
                    <div
                      key={agent.id}
                      className={cn(
                        "relative flex items-center transition-colors hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60",
                      )}
                    >
                      {isRenaming ? (
                        /* Inline rename row */
                        <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 overflow-hidden">
                          <div
                            className={cn(
                              "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border",
                              isActive
                                ? "border-neutral-400 dark:border-neutral-500"
                                : "border-neutral-200 dark:border-neutral-700",
                            )}
                          >
                            {agent.model === "realtime" ? (
                              <Mic
                                size={15}
                                className={`text-neutral-600 dark:text-neutral-400 ${!isActive ? "opacity-40" : ""}`}
                              />
                            ) : (
                              <Bot
                                size={15}
                                className={`text-neutral-600 dark:text-neutral-400 ${!isActive ? "opacity-40" : ""}`}
                              />
                            )}
                          </div>
                          <input
                            ref={inlineEditInputRef}
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            className="flex-1 min-w-0 text-sm font-medium text-neutral-900 dark:text-neutral-100 bg-transparent border-b border-neutral-400 dark:border-neutral-500 outline-none"
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={saveInlineEdit}
                            className="shrink-0 p-1 rounded-md text-green-500 hover:text-green-600 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                            title="Save"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={cancelInlineEdit}
                            className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-red-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleListSelect(agent)}
                            className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left"
                          >
                            <div
                              className={cn(
                                "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border",
                                isActive
                                  ? "border-neutral-400 dark:border-neutral-500"
                                  : "border-neutral-200 dark:border-neutral-700",
                              )}
                            >
                              {agent.model === "realtime" ? (
                                <Mic
                                  size={15}
                                  className={`text-neutral-600 dark:text-neutral-400 ${!isActive ? "opacity-40" : ""}`}
                                />
                              ) : (
                                <Bot
                                  size={15}
                                  className={`text-neutral-600 dark:text-neutral-400 ${!isActive ? "opacity-40" : ""}`}
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`flex-1 min-w-0 text-sm truncate ${isActive ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
                                >
                                  {agent.name}
                                </span>
                              </div>
                              {(() => {
                                const toolsCount = agent.tools.length + agent.servers.length;
                                return (
                                  (agent.skills.length > 0 ||
                                    toolsCount > 0 ||
                                    (config.repository && (agent.files?.length ?? 0) > 0)) && (
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                      {toolsCount > 0 && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                                          <Rocket size={9} />
                                          {toolsCount} {toolsCount === 1 ? "tool" : "tools"}
                                        </span>
                                      )}
                                      {config.repository && (agent.files?.length ?? 0) > 0 && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                                          <Folder size={9} />
                                          {agent.files?.length} {agent.files?.length === 1 ? "file" : "files"}
                                        </span>
                                      )}
                                      {agent.skills.length > 0 && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                                          <Sparkles size={9} />
                                          {agent.skills.length} {agent.skills.length === 1 ? "skill" : "skills"}
                                        </span>
                                      )}
                                    </div>
                                  )
                                );
                              })()}
                            </div>
                            {isActive && (
                              <span className="shrink-0 self-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-neutral-300 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 leading-none">
                                Active
                              </span>
                            )}
                          </button>
                          {/* Three-dot menu */}
                          <div className="shrink-0 pr-1">
                            <DropdownMenu
                              anchor="bottom end"
                              trigger={
                                <MenuButton
                                  className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                                  title="More options"
                                  aria-label="More options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreVertical size={14} />
                                </MenuButton>
                              }
                            >
                              <DropdownMenuItem icon={<PenLine size={12} />} onClick={() => startInlineEdit(agent)}>
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                icon={<Download size={12} />}
                                onClick={() => exportSingleAgentAsZip(agent.id)}
                              >
                                Export
                              </DropdownMenuItem>
                              <DropdownMenuDivider />
                              <DropdownMenuItem
                                icon={<Trash2 size={12} />}
                                destructive
                                onClick={async () => {
                                  if (
                                    !(await confirm({
                                      title: "Delete agent?",
                                      message: `"${agent.name}" will be permanently removed. This can't be undone.`,
                                      danger: true,
                                    }))
                                  )
                                    return;
                                  if (isActive) setCurrentAgent(null);
                                  void deleteAgent(agent.id);
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenu>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : /* Details view */
      currentAgent ? (
        <AgentDetails key={currentAgent.id} agent={currentAgent} />
      ) : null}

      <AgentWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={handleWizardCreated} />
    </div>
  );
}
