import { useState, useMemo, useRef, useEffect, type Dispatch } from "react";
import { Search, Check, Plus, X } from "lucide-react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { SkillCatalog } from "@/features/agent/components/SkillCatalog";
import type { Skill } from "@/features/skills/lib/skillParser";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface SkillsStepProps {
  selectedSkills: string[];
  dispatch: Dispatch<WizardAction>;
}

export function SkillsStep({ selectedSkills, dispatch }: SkillsStepProps) {
  const { skills } = useSkills();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch("");
    }
  }, [searchOpen]);

  const selected = useMemo(() => new Set(selectedSkills), [selectedSkills]);

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, search]);

  const handleSkillSaved = (skill: Skill, isNew: boolean) => {
    if (isNew && !selectedSkills.includes(skill.name)) {
      dispatch({ type: "TOGGLE_SKILL", name: skill.name });
    }
  };

  return (
    <div className="space-y-3">
      <StepHeader
        title="Choose skills"
        description="Skills are reusable prompt templates that teach your agent how to handle specific tasks — like writing code reviews or summarizing documents. Select existing ones below, or create a new one. You can skip this and add skills later."
      />

      {/* Actions + inline search */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCatalogOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <Plus size={11} /> New
        </button>
        {searchOpen ? (
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="w-full pl-7 pr-7 py-1 text-xs rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
            />
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/50 transition-colors"
          >
            <Search size={11} /> Filter
          </button>
        )}
      </div>

      {/* Skill list */}
      <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1">
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
              <button
                key={skill.id}
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_SKILL", name: skill.name })}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors ${
                  isSelected
                    ? "bg-neutral-100/80 dark:bg-neutral-800/30"
                    : "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40"
                }`}
              >
                <div
                  className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    isSelected
                      ? "bg-neutral-800 dark:bg-neutral-200 border-neutral-800 dark:border-neutral-200 text-white dark:text-neutral-900"
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

      <SkillCatalog
        isOpen={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        enabledSkillNames={selected}
        onToggle={(name) => dispatch({ type: "TOGGLE_SKILL", name })}
        onSkillSaved={handleSkillSaved}
        onImported={(names) => {
          for (const name of names) {
            if (!selectedSkills.includes(name)) {
              dispatch({ type: "TOGGLE_SKILL", name });
            }
          }
        }}
        initialView="new"
      />
    </div>
  );
}
