import { Settings2, ToggleLeft, ToggleRight } from "lucide-react";
import { type Dispatch, useMemo, useState } from "react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { WizardAction } from "../AgentWizard";
import { StepFilter } from "../StepFilter";
import { StepHeader } from "../StepHeader";

interface SkillsStepProps {
  selectedSkills: string[];
  dispatch: Dispatch<WizardAction>;
}

export function SkillsStep({ selectedSkills, dispatch }: SkillsStepProps) {
  const { skills, openSkillCatalog } = useSkills();
  const [search, setSearch] = useState("");

  const selected = useMemo(() => new Set(selectedSkills), [selectedSkills]);

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, search]);

  return (
    <div className="space-y-3">
      <StepHeader
        title="Choose skills"
        description="Add personal skills for your agent's specialized tasks. Built-in document, data and design skills are already available. You can add or change personal skills later."
      />

      {/* Actions + inline search */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openSkillCatalog()}
          className="-ml-2 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <Settings2 size={11} /> Manage skills
        </button>
        <StepFilter value={search} onChange={setSearch} />
      </div>

      {/* Skill list */}
      <div className="max-h-64 overflow-y-auto space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-6">
            {skills.length === 0
              ? "No skills yet. Create one above, or skip this step."
              : "No skills match your search."}
          </p>
        ) : (
          filtered.map((skill) => {
            const isSelected = selected.has(skill.name);
            return (
              <div key={skill.id} className="flex items-center gap-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {skill.name}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">{skill.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "TOGGLE_SKILL", name: skill.name })}
                  className={`shrink-0 ${isSelected ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
                >
                  {isSelected ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
