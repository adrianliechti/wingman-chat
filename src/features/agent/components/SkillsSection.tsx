import { useState, useMemo, useRef, useEffect } from "react";
import { X, Search, Plus, Zap, BookOpen } from "lucide-react";
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
  const [catalogInitial, setCatalogInitial] = useState<"list" | "new">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);

  const enabledSkills = useMemo(
    () => allSkills.filter((s) => agentSkillIds.has(s.name)).sort((a, b) => a.name.localeCompare(b.name)),
    [allSkills, agentSkillIds],
  );

  // Skills not yet enabled on this agent, filtered by search
  const availableSkills = useMemo(() => {
    const sorted = allSkills.filter((s) => !agentSkillIds.has(s.name)).sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [allSkills, agentSkillIds, search]);

  // Also filter enabled skills by search when searching
  const filteredEnabled = useMemo(() => {
    if (!search.trim()) return enabledSkills;
    const q = search.toLowerCase();
    return enabledSkills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [enabledSkills, search]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch("");
    }
  }, [searchOpen]);

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

  const openNewSkill = () => {
    setCatalogInitial("new");
    setCatalogOpen(true);
  };

  const openCatalog = () => {
    setCatalogInitial("list");
    setCatalogOpen(true);
  };

  return (
    <>
      <Section
        title="Skills"
        isOpen={true}
        collapsible={false}
        headerAction={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openNewSkill}
              className="p-0.5 rounded text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              title="Create new skill"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(!searchOpen)}
              className={`p-0.5 rounded transition-colors ${
                searchOpen
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              }`}
              title="Search & add skills"
            >
              <Search size={13} />
            </button>
            <button
              type="button"
              onClick={openCatalog}
              className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <BookOpen size={12} /> Catalog
            </button>
          </div>
        }
      >
        {/* Inline search */}
        {searchOpen && (
          <div className="mb-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter skills…"
                className="w-full pl-7 pr-7 py-1 text-xs rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-blue-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Enabled skills */}
        {filteredEnabled.length > 0 && (
          <div className="space-y-0.5">
            {filteredEnabled.map((skill) => (
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

        {/* Available (not yet enabled) skills — shown when search is open */}
        {searchOpen && availableSkills.length > 0 && (
          <>
            {filteredEnabled.length > 0 && (
              <div className="border-t border-neutral-200/40 dark:border-neutral-700/40 my-1.5" />
            )}
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {availableSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => toggleSkill(skill.name)}
                  className="w-full flex items-center gap-2 py-1.5 rounded hover:bg-neutral-50/60 dark:hover:bg-neutral-800/40 transition-colors text-left"
                >
                  <span className="shrink-0 w-3.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs text-neutral-600 dark:text-neutral-400 truncate">
                      {skill.name}
                    </div>
                    <div className="text-[10px] text-neutral-400 dark:text-neutral-500 line-clamp-1">
                      {skill.description}
                    </div>
                  </div>
                  <Plus size={12} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Empty state */}
        {searchOpen && filteredEnabled.length === 0 && availableSkills.length === 0 && (
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500 text-center py-2">
            {search ? "No skills match your search." : "No skills available."}
          </p>
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
