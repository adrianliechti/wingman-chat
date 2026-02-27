import { useState, useMemo } from 'react';
import { Sparkles, Plus, Download, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import { useSkills } from '@/features/skills/hooks/useSkills';
import { SkillEditor } from './SkillEditor';
import { parseSkillFile, downloadSkill } from '@/features/skills/lib/skillParser';
import type { Skill } from '@/features/skills/lib/skillParser';
import type { Agent } from '@/features/agent/types/agent';
import { Section } from './Section';
import JSZip from 'jszip';

interface SkillsSectionProps {
  agent: Agent;
  isOpen: boolean;
  onToggle: () => void;
}

export function SkillsSection({ agent, isOpen, onToggle }: SkillsSectionProps) {
  const { agents, updateAgent } = useAgents();
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);

  const toggleSkill = (skillName: string) => {
    const current = agent.skills || [];
    const next = current.includes(skillName)
      ? current.filter(n => n !== skillName)
      : [...current, skillName];
    updateAgent(agent.id, { skills: next });
  };

  const handleNew = () => {
    setEditingSkill(null);
    setEditorOpen(true);
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setEditorOpen(true);
  };

  const handleSave = (data: Omit<Skill, 'id'>) => {
    if (editingSkill) {
      updateSkill(editingSkill.id, data);
      // Propagate skill rename to all agents that reference the old name
      if (data.name && data.name !== editingSkill.name) {
        for (const a of agents) {
          if (a.skills?.includes(editingSkill.name)) {
            updateAgent(a.id, {
              skills: a.skills.map(n => n === editingSkill.name ? data.name : n),
            });
          }
        }
      }
    } else {
      const newSkill = addSkill(data);
      updateAgent(agent.id, { skills: [...(agent.skills || []), newSkill.name] });
    }
  };

  const handleDelete = (skill: Skill) => {
    if (window.confirm(`Delete the skill "${skill.name}"?`)) {
      removeSkill(skill.id);
      updateAgent(agent.id, { skills: (agent.skills || []).filter(n => n !== skill.name) });
    }
  };

  const handleImport = () => {
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
                  const s = addSkill(result.skill);
                  newIds.push(s.name);
                  importedCount++;
                }
              } catch { /* skip */ }
            }
          } else {
            const content = await file.text();
            const result = parseSkillFile(content);
            if (result.success) {
              const s = addSkill(result.skill);
              newIds.push(s.name);
              importedCount++;
            }
          }
        } catch { /* skip */ }
      }
      if (importedCount > 0) {
        updateAgent(agent.id, { skills: [...(agent.skills || []), ...newIds] });
      }
    };
    input.click();
  };

  return (
    <>
      <Section
        title="Skills"
        icon={<Sparkles size={16} />}
        isOpen={isOpen}
        onOpenToggle={onToggle}
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
                  onClick={() => toggleSkill(skill.name)}
                  className={`shrink-0 ${agentSkillIds.has(skill.name) ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
                >
                  {agentSkillIds.has(skill.name) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-neutral-900 dark:text-neutral-100 truncate">{skill.name}</div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">{skill.description}</div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleEdit(skill)}
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
                    onClick={() => handleDelete(skill)}
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
            onClick={handleNew}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            <Plus size={10} />
            Add
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            <Download size={10} />
            Import
          </button>
        </div>
      </Section>

      <SkillEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
        skill={editingSkill}
      />
    </>
  );
}
