import { useState, useMemo } from "react";
import { X, BookOpen, Zap } from "lucide-react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { SkillCatalog } from "./SkillCatalog";
import type { Skill } from "@/features/skills/lib/skillParser";
import type { Agent } from "@/features/agent/types/agent";
import { Section } from "./Section";

interface SkillsSectionProps {
  agent: Agent;
}

export function SkillsSection({ agent }: SkillsSectionProps) {
  const { agents, updateAgent } = useAgents();
  const { skills: allSkills } = useSkills();

  const [catalogOpen, setCatalogOpen] = useState(false);

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);

  const enabledSkills = useMemo(
    () => allSkills.filter((s) => agentSkillIds.has(s.name)).sort((a, b) => a.name.localeCompare(b.name)),
    [allSkills, agentSkillIds],
  );

  const toggleSkill = (skillName: string) => {
    const current = agent.skills || [];
    const next = current.includes(skillName) ? current.filter((n) => n !== skillName) : [...current, skillName];
    updateAgent(agent.id, { skills: next });
  };

  const handleSkillSaved = (skill: Skill, isNew: boolean, oldName?: string) => {
    if (isNew) {
      updateAgent(agent.id, { skills: [...(agent.skills || []), skill.name] });
    } else if (oldName) {
      for (const a of agents) {
        if (a.skills?.includes(oldName)) {
          updateAgent(a.id, {
            skills: a.skills.map((n) => (n === oldName ? skill.name : n)),
          });
        }
      }
    }
  };

  return (
    <>
      <Section
        title="Skills"
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            <BookOpen size={12} /> Catalog
          </button>
        }
      >
        {enabledSkills.length > 0 && (
          <div className="space-y-1">
            {enabledSkills.map((skill) => (
              <div key={skill.id} className="flex items-center gap-2 py-1.5">
                <Zap size={14} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-neutral-900 dark:text-neutral-100 truncate">
                    {skill.name}
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                    {skill.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.name)}
                  className="shrink-0 p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  title="Remove skill"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <SkillCatalog
        isOpen={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        enabledSkillNames={agentSkillIds}
        onToggle={toggleSkill}
        onSkillSaved={handleSkillSaved}
        onImported={(names) => {
          updateAgent(agent.id, { skills: [...(agent.skills || []), ...names] });
        }}
      />
    </>
  );
}
