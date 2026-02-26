import { useState, useRef, useEffect, Fragment, useMemo } from 'react';
import {
  Plus, Folder, FileText, X, ChevronDown, Check, Edit,
  Trash2, Loader2, Upload, PenLine, MessageSquare, Download,
  ChevronRight, Sparkles, ToggleLeft, ToggleRight,
  Globe, Code, Image, Pencil, Bot, Server,
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import { useAgent } from '@/features/agent/hooks/useAgent';
import { useSkills } from '@/features/settings/hooks/useSkills';
import { getConfig } from '@/shared/config';
import type { Agent } from '@/features/agent/types/agent';
import type { RepositoryFile } from '@/features/repository/types/repository';
import type { BridgeServer } from '@/features/agent/types/agent';
import { BridgeEditor } from '@/features/settings/components/BridgeEditor';
import { SkillEditor } from '@/features/settings/components/SkillEditor';
import { parseSkillFile, downloadSkill } from '@/features/settings/lib/skillParser';
import type { Skill } from '@/features/settings/lib/skillParser';
import JSZip from 'jszip';

// ─── Collapsible section with enable checkbox ───

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  isOpen: boolean;
  onOpenToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, icon, enabled, onToggle, isOpen, onOpenToggle, children }: SectionProps) {
  return (
    <div className="border-b border-neutral-200/40 dark:border-neutral-700/40">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className={`shrink-0 transition-colors ${enabled ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
          title={enabled ? 'Disable' : 'Enable'}
        >
          {enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
        </button>
        <button
          type="button"
          onClick={onOpenToggle}
          className="flex-1 flex items-center justify-between py-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-neutral-600 dark:text-neutral-400">{icon}</span>
            <span className={`text-sm font-medium ${enabled ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500'}`}>{title}</span>
          </div>
          <ChevronRight
            size={14}
            className={`text-neutral-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </div>
      <div className={`grid transition-all duration-200 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Agent details: collapsible sections ───

interface AgentDetailsProps {
  agent: Agent;
}

function AgentDetails({ agent }: AgentDetailsProps) {
  const config = getConfig();
  const { files, addFile, removeFile } = useAgent(agent.id);
  const { updateAgent, addServer, updateServer, removeServer, toggleServer } = useAgents();
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();

  const [openSection, setOpenSection] = useState<string | null>('instructions');
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instructions editing
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [instructionsValue, setInstructionsValue] = useState('');

  // Bridge editor state
  const [bridgeEditorOpen, setBridgeEditorOpen] = useState(false);
  const [editingBridge, setEditingBridge] = useState<BridgeServer | null>(null);

  // Skill editor state
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const toggleSection = (key: string) => {
    setOpenSection(prev => (prev === key ? null : key));
  };

  // ── Instructions ──

  const startEditingInstructions = () => {
    setInstructionsValue(agent.instructions || '');
    setIsEditingInstructions(true);
  };

  const saveInstructions = () => {
    updateAgent(agent.id, { instructions: instructionsValue.trim() || undefined });
    setIsEditingInstructions(false);
  };

  const cancelEditingInstructions = () => {
    setIsEditingInstructions(false);
    setInstructionsValue('');
  };

  const handleInstructionsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingInstructions();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveInstructions();
    }
  };

  // ── Repository file handling ──

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await addFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await addFile(file);
    }
    e.target.value = '';
  };

  // ── Skills ──

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);

  const toggleSkillForAgent = (skillId: string) => {
    const current = agent.skills || [];
    const newSkills = current.includes(skillId)
      ? current.filter(id => id !== skillId)
      : [...current, skillId];
    updateAgent(agent.id, { skills: newSkills });
  };

  const handleNewSkill = () => {
    setEditingSkill(null);
    setSkillEditorOpen(true);
  };

  const handleEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setSkillEditorOpen(true);
  };

  const handleSaveSkill = (skillData: Omit<Skill, 'id' | 'enabled'>) => {
    if (editingSkill) {
      updateSkill(editingSkill.id, skillData);
    } else {
      const newSkill = addSkill({ ...skillData, enabled: true });
      // Auto-enable the new skill for this agent
      updateAgent(agent.id, { skills: [...(agent.skills || []), newSkill.id] });
    }
  };

  const handleDeleteSkill = (skill: Skill) => {
    if (window.confirm(`Delete the skill "${skill.name}"?`)) {
      removeSkill(skill.id);
      // Also remove from this agent's list
      updateAgent(agent.id, { skills: (agent.skills || []).filter(id => id !== skill.id) });
    }
  };

  const handleImportSkills = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.md';
    input.multiple = true;
    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      let importedCount = 0;
      const newIds: string[] = [];
      for (const file of Array.from(files)) {
        try {
          if (file.name.endsWith('.zip')) {
            const zip = await JSZip.loadAsync(file);
            for (const [filename, zipEntry] of Object.entries(zip.files)) {
              if (zipEntry.dir || !filename.endsWith('.md')) continue;
              try {
                const content = await zipEntry.async('string');
                const result = parseSkillFile(content);
                if (result.success) {
                  const s = addSkill({ ...result.skill, enabled: true });
                  newIds.push(s.id);
                  importedCount++;
                }
              } catch { /* skip */ }
            }
          } else {
            const content = await file.text();
            const result = parseSkillFile(content);
            if (result.success) {
              const s = addSkill({ ...result.skill, enabled: true });
              newIds.push(s.id);
              importedCount++;
            }
          }
        } catch { /* skip */ }
      }
      if (importedCount > 0) {
        // Auto-enable imported skills for this agent
        updateAgent(agent.id, { skills: [...(agent.skills || []), ...newIds] });
      }
    };
    input.click();
  };

  // ── Tools ──

  const availableTools = useMemo(() => {
    const tools: { id: string; label: string; icon: React.ReactNode }[] = [];
    if (config.internet) tools.push({ id: 'internet', label: 'Web Search', icon: <Globe size={16} /> });
    if (config.interpreter) tools.push({ id: 'interpreter', label: 'Interpreter', icon: <Code size={16} /> });
    if (config.renderer) tools.push({ id: 'renderer', label: 'Renderer', icon: <Image size={16} /> });
    return tools;
  }, [config]);

  const agentToolIds = useMemo(() => new Set(agent.tools || []), [agent.tools]);

  const toggleToolForAgent = (toolId: string) => {
    const current = agent.tools || [];
    const newTools = current.includes(toolId)
      ? current.filter(id => id !== toolId)
      : [...current, toolId];
    updateAgent(agent.id, { tools: newTools });
  };

  // ── Bridge helpers ──

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

  const hasInstructions = !!agent.instructions?.trim();

  return (
    <>
      <BridgeEditor
        isOpen={bridgeEditorOpen}
        onClose={() => setBridgeEditorOpen(false)}
        onSave={handleSaveBridge}
        bridge={editingBridge}
      />

      {/* Instructions Edit Dialog */}
      <Transition appear show={isEditingInstructions} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={cancelEditingInstructions}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-800 p-6 text-left align-middle shadow-xl transition-all">
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      Instructions help the AI understand how to behave and what context to use for this agent.
                    </p>
                    <textarea
                      value={instructionsValue}
                      onChange={e => setInstructionsValue(e.target.value)}
                      onKeyDown={handleInstructionsKeyDown}
                      rows={12}
                      className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-y min-h-[200px]"
                      placeholder="Enter instructions for this agent..."
                      autoFocus
                    />
                    <div className="flex gap-3 justify-end pt-2">
                      <button type="button" onClick={cancelEditingInstructions} className="px-4 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-300 rounded-md transition-colors">
                        Cancel
                      </button>
                      <button type="button" onClick={saveInstructions} className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-md transition-colors">
                        Save Instructions
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <div
        className={`flex flex-col flex-1 overflow-auto ${isDragOver ? 'bg-slate-50/50 dark:bg-slate-900/50' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-2 border-dashed border-slate-400 dark:border-slate-500 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Plus size={32} className="mx-auto text-neutral-600 dark:text-neutral-400 mb-2" />
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Drop files to add</p>
            </div>
          </div>
        )}

        {/* ── Instructions section ── */}
        <Section
          title="Instructions"
          icon={<PenLine size={16} />}
          enabled={hasInstructions}
          onToggle={startEditingInstructions}
          isOpen={openSection === 'instructions'}
          onOpenToggle={() => toggleSection('instructions')}
        >
          <div
            onClick={startEditingInstructions}
            className="text-sm text-neutral-500 dark:text-neutral-400 bg-white/30 dark:bg-neutral-900/60 p-3 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-900/80 transition-colors backdrop-blur-lg"
          >
            {agent.instructions?.trim() ? (
              <p className="line-clamp-3 text-neutral-700 dark:text-neutral-300">{agent.instructions}</p>
            ) : (
              <div className="flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <Edit size={12} /> Add instructions
              </div>
            )}
          </div>
        </Section>

        {/* ── Files section ── */}
        {config.repository && (
          <Section
            title="Files"
            icon={<Folder size={16} />}
            enabled={agent.repositoryEnabled}
            onToggle={() => updateAgent(agent.id, { repositoryEnabled: !agent.repositoryEnabled })}
            isOpen={openSection === 'repository'}
            onOpenToggle={() => toggleSection('repository')}
          >
            {agent.repositoryEnabled ? (
              <div className="space-y-2">
                {/* Upload button */}
                <div
                  className="border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer bg-white/30 dark:bg-neutral-900/60 backdrop-blur-lg border-neutral-300 dark:border-neutral-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-900/80"
                  onClick={() => document.getElementById('agent-file-upload')?.click()}
                >
                  <div className="flex items-center justify-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                    <Upload size={12} /> Upload Files
                  </div>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    id="agent-file-upload"
                  />
                </div>

                {/* File grid */}
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {files
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((file: RepositoryFile) => (
                        <div key={file.id} className="relative group" title={file.name}>
                          <div className={`relative w-16 h-16 ${
                            file.status === 'processing'
                              ? 'bg-white/30 dark:bg-neutral-900/80 backdrop-blur-lg border-2 border-dashed border-white/50 dark:border-neutral-600/60'
                              : file.status === 'error'
                              ? 'bg-red-100/40 dark:bg-red-900/25 backdrop-blur-lg border border-red-300/40 dark:border-red-600/25'
                              : 'bg-white/40 dark:bg-neutral-900/80 backdrop-blur-lg border border-white/40 dark:border-neutral-600/60'
                          } rounded-xl shadow-sm flex flex-col items-center justify-center p-1.5 hover:shadow-md transition-all`}>
                            {file.status === 'processing' ? (
                              <div className="flex flex-col items-center">
                                <Loader2 size={16} className="animate-spin text-neutral-500 dark:text-neutral-400 mb-0.5" />
                                <div className="text-[10px] text-neutral-600 dark:text-neutral-400">{file.progress}%</div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center text-center w-full">
                                <FileText size={14} className={`mb-0.5 shrink-0 ${file.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-600 dark:text-neutral-300'}`} />
                                <div className={`text-[10px] font-medium truncate w-full leading-tight ${file.status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-neutral-700 dark:text-neutral-200'}`}>{file.name}</div>
                              </div>
                            )}
                            <button
                              type="button"
                              className="absolute top-0.5 right-0.5 size-4 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                              onClick={() => removeFile(file.id)}
                              title="Remove file"
                            >
                              <X size={8} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                    {files.length} {files.length === 1 ? 'file' : 'files'}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-2">
                Enable to upload files the AI can reference.
              </p>
            )}
          </Section>
        )}

        {/* ── Skills section ── */}
        <Section
          title="Skills"
          icon={<Sparkles size={16} />}
          enabled={agent.skills.length > 0}
          onToggle={() => {
            // If all skills enabled, disable all; else enable all
            if (agent.skills.length > 0) {
              updateAgent(agent.id, { skills: [] });
            } else {
              updateAgent(agent.id, { skills: allSkills.map(s => s.id) });
            }
          }}
          isOpen={openSection === 'skills'}
          onOpenToggle={() => toggleSection('skills')}
        >
          {allSkills.length > 0 ? (
            <div className="space-y-1.5">
              {allSkills.map(skill => (
                <div
                  key={skill.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white/30 dark:bg-neutral-900/40 border border-neutral-200/40 dark:border-neutral-700/40"
                >
                  <button
                    type="button"
                    onClick={() => toggleSkillForAgent(skill.id)}
                    className={`shrink-0 ${agentSkillIds.has(skill.id) ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                  >
                    {agentSkillIds.has(skill.id) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs text-neutral-900 dark:text-neutral-100 truncate">{skill.name}</div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">{skill.description}</div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditSkill(skill)}
                      className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                      title="Edit skill"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSkill(skill)}
                      className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                      title="Export skill"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSkill(skill)}
                      className="p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Delete skill"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-2">
              No skills defined yet.
            </p>
          )}

          {/* Skill action buttons */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={handleNewSkill}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              <Plus size={10} />
              Add
            </button>
            <button
              type="button"
              onClick={handleImportSkills}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              <Download size={10} />
              Import
            </button>
          </div>
        </Section>

        {/* Skill editor modal */}
        <SkillEditor
          isOpen={skillEditorOpen}
          onClose={() => setSkillEditorOpen(false)}
          onSave={handleSaveSkill}
          skill={editingSkill}
        />

        {/* ── Enabled Tools section ── */}
        <Section
          title="Tools"
          icon={<Code size={16} />}
          enabled={agent.tools.length > 0 || agent.servers.length > 0}
          onToggle={() => {
            // If any tools enabled, disable all; else enable all
            if (agent.tools.length > 0) {
              updateAgent(agent.id, { tools: [] });
            } else {
              updateAgent(agent.id, { tools: availableTools.map(t => t.id) });
            }
          }}
          isOpen={openSection === 'tools'}
          onOpenToggle={() => toggleSection('tools')}
        >
          <div className="space-y-3">
            {/* Built-in tools */}
            {availableTools.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-medium">Built-in</div>
                {availableTools.map(tool => (
                  <div key={tool.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/30 dark:bg-neutral-900/40 border border-neutral-200/40 dark:border-neutral-700/40">
                    <button
                      type="button"
                      onClick={() => toggleToolForAgent(tool.id)}
                      className={`shrink-0 ${agentToolIds.has(tool.id) ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                    >
                      {agentToolIds.has(tool.id) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <span className="text-neutral-600 dark:text-neutral-400">{tool.icon}</span>
                    <span className="text-xs font-medium text-neutral-900 dark:text-neutral-100">{tool.label}</span>
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
                agent.servers.map(server => (
                  <div key={server.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/30 dark:bg-neutral-900/40 border border-neutral-200/40 dark:border-neutral-700/40 group">
                    <button
                      type="button"
                      onClick={() => toggleServer(agent.id, server.id)}
                      className={`shrink-0 ${server.enabled ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                    >
                      {server.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <Server size={14} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
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
                ))
              ) : (
                <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-1">
                  No MCP servers configured.
                </p>
              )}
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}

// ─── Main AgentDrawer component ───

export function AgentDrawer() {
  const {
    agents,
    currentAgent,
    createAgent,
    setCurrentAgent,
    updateAgent,
    deleteAgent,
    setShowAgentDrawer,
  } = useAgents();

  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (!inlineEditingId && !isCreatingNew) {
          setIsDropdownOpen(false);
        }
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, inlineEditingId, isCreatingNew]);

  const handleCreateAgent = async (name: string) => {
    await createAgent(name);
    setIsCreatingNew(false);
    setEditingName('');
    setIsDropdownOpen(false);
  };

  const startInlineEdit = (agent: Agent) => {
    setInlineEditingId(agent.id);
    setEditingName(agent.name);
  };

  const saveInlineEdit = () => {
    if (inlineEditingId && editingName.trim()) {
      updateAgent(inlineEditingId, { name: editingName.trim() });
      setInlineEditingId(null);
      setEditingName('');
      setIsDropdownOpen(false);
    }
  };

  const cancelInlineEdit = () => {
    setInlineEditingId(null);
    setEditingName('');
  };

  const startCreatingNew = () => {
    setIsCreatingNew(true);
    setEditingName('');
  };

  const saveNewAgent = () => {
    if (editingName.trim()) {
      handleCreateAgent(editingName.trim());
    }
  };

  const cancelNewAgent = () => {
    setIsCreatingNew(false);
    setEditingName('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isCreatingNew) saveNewAgent();
      else saveInlineEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isCreatingNew) cancelNewAgent();
      else cancelInlineEdit();
    }
  };

  const handleAgentSelect = (agent: Agent | null) => {
    setCurrentAgent(agent);
    if (!agent) setShowAgentDrawer(false);
    setIsDropdownOpen(false);
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
                {currentAgent?.name || 'None'}
              </span>
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown size={16} className={`text-neutral-400 dark:text-neutral-300 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {isDropdownOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 backdrop-blur-xl">
              {/* None Option */}
              <div
                className="group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 flex items-center gap-2"
                onClick={() => handleAgentSelect(null)}
              >
                <X size={16} className="text-neutral-600 dark:text-neutral-300 shrink-0" />
                <span className={`block truncate text-sm ${!currentAgent ? 'font-semibold' : 'font-normal'}`}>None</span>
              </div>

              {/* Create New */}
              <div className={`group relative cursor-pointer select-none py-2 pl-3 pr-4 rounded-lg text-neutral-900 dark:text-neutral-100 ${!isCreatingNew ? 'hover:bg-neutral-200 dark:hover:bg-neutral-700/80' : ''}`}>
                {isCreatingNew ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Plus size={16} className="text-neutral-600 dark:text-neutral-400 shrink-0" />
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      autoFocus
                      className="flex-1 text-sm bg-transparent border-0 border-b border-slate-500 rounded-none px-1 py-0 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-slate-600 dark:focus:border-slate-400"
                      placeholder="Agent name"
                      onClick={e => e.stopPropagation()}
                    />
                    <button type="button" onClick={e => { e.stopPropagation(); saveNewAgent(); }} className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors shrink-0" title="Create">
                      <Check size={12} />
                    </button>
                    <button type="button" onClick={e => { e.stopPropagation(); cancelNewAgent(); }} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors shrink-0" title="Cancel">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); startCreatingNew(); }} className="flex items-center gap-2 w-full text-sm text-neutral-600 dark:text-neutral-400 font-medium">
                    <Plus size={16} /> Create New Agent
                  </button>
                )}
              </div>

              {/* Existing Agents */}
              {agents
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(agent => {
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
                              type="text"
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={handleInputKeyDown}
                              autoFocus
                              className="flex-1 text-sm bg-transparent border-0 border-b border-slate-500 rounded-none px-1 py-0 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-slate-600 dark:focus:border-slate-400"
                              onClick={e => e.stopPropagation()}
                            />
                            <button type="button" onClick={e => { e.stopPropagation(); saveInlineEdit(); }} className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors shrink-0" title="Save">
                              <Check size={12} />
                            </button>
                            <button type="button" onClick={e => { e.stopPropagation(); cancelInlineEdit(); }} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors shrink-0" title="Cancel">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => handleAgentSelect(agent)} className="flex items-center gap-2 flex-1 text-left min-w-0">
                            <span className={`block truncate text-sm ${isCurrent ? 'font-semibold' : 'font-normal'}`}>{agent.name}</span>
                          </button>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2">
                          <button type="button" onClick={e => { e.stopPropagation(); startInlineEdit(agent); }} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-400 rounded transition-colors" title="Edit name">
                            <Edit size={12} />
                          </button>
                          <button type="button" onClick={e => {
                            e.stopPropagation();
                            if (window.confirm(`Delete agent "${agent.name}"?`)) {
                              deleteAgent(agent.id);
                              if (isCurrent) setCurrentAgent(null);
                            }
                          }} className="p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors" title="Delete agent">
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
            {agents.length === 0 ? 'Create an Agent' : 'No Agent Selected'}
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 max-w-xs">
            {agents.length === 0
              ? 'Agents bundle instructions, files, skills, and tools into a reusable configuration.'
              : 'Select an agent from the dropdown above to configure it.'}
          </p>
          {agents.length === 0 && (
            <div className="text-xs text-neutral-500 dark:text-neutral-500 space-y-2">
              <div className="flex items-center gap-2"><PenLine size={12} className="shrink-0" /><span>Custom instructions</span></div>
              <div className="flex items-center gap-2"><Folder size={12} className="shrink-0" /><span>Upload reference documents</span></div>
              <div className="flex items-center gap-2"><Sparkles size={12} className="shrink-0" /><span>Select specialized skills</span></div>
              <div className="flex items-center gap-2"><MessageSquare size={12} className="shrink-0" /><span>Configure tools & MCP servers</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
