import { Dialog, Transition } from "@headlessui/react";
import {
  Funnel,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { Tooltip } from "@/shared/ui/Tooltip";
import { Section } from "./Section";

interface SkillsSectionProps {
  agent: Agent;
}

export function SkillsSection({ agent }: SkillsSectionProps) {
  const { updateAgent } = useAgents();
  const { skills: allSkills, openSkillCatalog } = useSkills();
  const { plugins: allPlugins } = usePlugins();

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);
  const agentPluginIds = useMemo(() => new Set(agent.plugins || []), [agent.plugins]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");

  const filteredSkills = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [allSkills, filterSearch]);

  const skillsEnabled = agentSkillIds.size > 0;

  const toggleSkills = () => {
    if (skillsEnabled) {
      updateAgent(agent.id, { skills: [] });
    } else {
      updateAgent(agent.id, { skills: allSkills.map((s) => s.name) });
    }
  };

  const togglePlugin = (pluginId: string) => {
    const current = agent.plugins || [];
    const next = current.includes(pluginId)
      ? current.filter((id) => id !== pluginId)
      : [...current, pluginId];
    updateAgent(agent.id, { plugins: next });
  };

  return (
    <>
      <Section
        title="Skills & Plugins"
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            onClick={() => openSkillCatalog()}
          >
            <Settings2 size={12} /> Manage
          </button>
        }
      >
        <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
          <div className="flex items-center gap-2 py-1.5">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!skillsEnabled ? "opacity-40" : ""}`}
              >
                <Sparkles size={13} />
              </div>
              <span
                className={`min-w-0 text-xs truncate ${skillsEnabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
              >
                My Skills
              </span>
            </div>
            <Tooltip content="Filter skills" side="top" className="shrink-0 relative">
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="flex items-center justify-center w-5 h-5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                <Funnel size={13} />
              </button>
              {skillsEnabled && (
                <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-neutral-500 px-0.5 text-[9px] font-semibold leading-none text-white pointer-events-none">
                  {agentSkillIds.size}
                </span>
              )}
            </Tooltip>
            <button
              type="button"
              onClick={toggleSkills}
              className={`shrink-0 ${skillsEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
            >
              {skillsEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
            </button>
          </div>

          {allPlugins.map((plugin) => {
            const enabled = agentPluginIds.has(plugin.id);
            return (
              <div key={plugin.id} className="flex items-center gap-2 py-1.5">
                <button
                  type="button"
                  onClick={() => togglePlugin(plugin.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <Tooltip
                    content={plugin.description ?? plugin.title ?? plugin.id}
                    side="left"
                    className="inline-flex items-center gap-2 min-w-0"
                  >
                    <div
                      className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!enabled ? "opacity-40" : ""}`}
                    >
                      {plugin.icon ? (
                        <img src={plugin.icon} alt="" className="h-4 w-4 rounded object-contain" />
                      ) : (
                        <Puzzle size={13} />
                      )}
                    </div>
                    <span
                      className={`min-w-0 text-xs truncate ${enabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
                    >
                      {plugin.title || plugin.id}
                    </span>
                  </Tooltip>
                </button>
                <button
                  type="button"
                  onClick={() => togglePlugin(plugin.id)}
                  className={`shrink-0 ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
                >
                  {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Transition appear show={filterOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-80"
          onClose={() => {
            setFilterOpen(false);
            setFilterSearch("");
          }}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl sm:rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl sm:border sm:border-neutral-200/50 dark:sm:border-neutral-700/50 h-[92dvh] sm:h-[75dvh]">
                  <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 py-2 dark:border-neutral-800/60">
                    <div className="w-32 shrink-0">
                      <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Skills
                      </Dialog.Title>
                    </div>
                    <div className="flex flex-1 items-center justify-center">
                      <div className="flex w-full max-w-xs sm:w-64 items-center gap-2 rounded-md border border-neutral-200/70 bg-neutral-50/50 px-2 py-1.5 focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-neutral-500/15 dark:border-neutral-700/50 dark:bg-neutral-800/30 dark:focus-within:border-neutral-600">
                        <Search size={11} className="shrink-0 text-neutral-400" />
                        <input
                          type="text"
                          value={filterSearch}
                          onChange={(e) => setFilterSearch(e.target.value)}
                          placeholder="Search skills…"
                          className="flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                        />
                        {filterSearch && (
                          <button
                            type="button"
                            onClick={() => setFilterSearch("")}
                            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex w-32 items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterOpen(false);
                          setFilterSearch("");
                        }}
                        className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <ul className="flex-1 overflow-y-auto">
                    {filteredSkills.length === 0 && (
                      <li className="px-5 py-6 text-xs text-center text-neutral-400 dark:text-neutral-500">
                        {allSkills.length === 0
                          ? "No skills available"
                          : "No skills match your search"}
                      </li>
                    )}
                    {filteredSkills.map((skill) => {
                      const active = agentSkillIds.has(skill.name);
                      const toggle = () => {
                        const current = agent.skills || [];
                        const next = active
                          ? current.filter((n) => n !== skill.name)
                          : [...current, skill.name];
                        updateAgent(agent.id, { skills: next });
                      };
                      return (
                        <li
                          key={skill.id}
                          className="border-t border-neutral-200/40 first:border-t-0 dark:border-neutral-800/40"
                        >
                          <div className="flex w-full items-center gap-3 pl-5 pr-3 py-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                              <Sparkles
                                size={16}
                                className="text-neutral-400 dark:text-neutral-500"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                {skill.name}
                              </span>
                              {skill.description && (
                                <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
                                  {skill.description}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={toggle}
                              className={`shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
                            >
                              {active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
