import { Settings, Settings2, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { Skill } from "@/features/skills/lib/skillParser";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";
import { SkillCatalog } from "./SkillCatalog";

interface SkillsSectionProps {
  agent: Agent;
}

export function SkillsSection({ agent }: SkillsSectionProps) {
  const { agents, updateAgent } = useAgents();
  const { skills: allSkills } = useSkills();

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogInitial, setCatalogInitial] = useState<"list" | "new">("list");

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

  const getInitials = (name: string) =>
    name
      .split(/[-_\s]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");

  return (
    <>
      <Section
        title="Skills"
        count={enabledSkills.length}
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            onClick={() => {
              setCatalogInitial("list");
              setCatalogOpen(true);
            }}
          >
            <Settings2 size={12} /> Manage skills
          </button>
        }
      >
        {/* Empty state */}
        {enabledSkills.length === 0 && (
          <SectionEmptyState
            icon={<Sparkles size={13} />}
            label="No skills attached"
            description="Add skills to extend this agent"
            onClick={() => {
              setCatalogOpen(true);
              setCatalogInitial("list");
            }}
          />
        )}

        {/* Enabled skills */}
        {enabledSkills.length > 0 && (
          <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
            {enabledSkills.map((skill) => (
              <div key={skill.id} className="flex items-center gap-2 py-1.5">
                <div className="shrink-0 w-5 h-5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center text-[9px] font-semibold text-neutral-600 dark:text-neutral-300">
                  {getInitials(skill.name)}
                </div>
                <span
                  className="flex-1 min-w-0 text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate"
                  title={skill.description}
                >
                  {skill.name}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.name)}
                  className="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
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
        initialView={catalogInitial}
      />
    </>
  );
}
