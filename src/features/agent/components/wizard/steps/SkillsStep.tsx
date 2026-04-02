import { useState, useMemo, type Dispatch } from "react";
import { Search, Zap, Check } from "lucide-react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface SkillsStepProps {
  selectedSkills: string[];
  dispatch: Dispatch<WizardAction>;
}

export function SkillsStep({ selectedSkills, dispatch }: SkillsStepProps) {
  const { skills } = useSkills();
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
        description="Skills give your agent specialized expertise for specific tasks. This is optional — you can add or create skills anytime from the agent drawer."
      />

      {/* Selected chips */}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => dispatch({ type: "TOGGLE_SKILL", name })}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              <Zap size={10} /> {name} &times;
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-blue-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
        />
      </div>

      {/* Skill list */}
      <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-6">
            {skills.length === 0 ? "No skills available. You can create skills after setup." : "No skills match your search."}
          </p>
        ) : (
          filtered.map((skill) => {
            const isSelected = selected.has(skill.name);
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_SKILL", name: skill.name })}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors ${
                  isSelected
                    ? "bg-blue-50/80 dark:bg-blue-950/30"
                    : "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40"
                }`}
              >
                <div
                  className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    isSelected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-neutral-300 dark:border-neutral-600"
                  }`}
                >
                  {isSelected && <Check size={10} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {skill.name}
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                    {skill.description}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
