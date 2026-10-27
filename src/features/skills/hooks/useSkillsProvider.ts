import { useEffect, useMemo } from "react";
import type { Agent } from "@/features/agent/types/agent";
import { pluginEntries } from "@/features/plugins/lib/pluginProvider";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import {
  createSkillsProvider,
  libraryEntries,
  SKILLS_PROVIDER_ID,
  type SkillEntry,
  type SkillSources,
  type SkillsToolProvider,
  builtinTemplateEntries,
} from "@/features/skills/lib/skillsProvider";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { skillName } from "../lib/skillSource";
import { useSkills } from "./useSkills";
import { useSkillTemplates } from "./useSkillTemplates";

/**
 * The app's single Skills tool provider — one `load_skill` surface for every mode.
 * The agent and no-agent cases are the same provider with different inputs (not
 * two providers sharing an id), so a duplicate `load_skill` can never arise.
 *
 * Entries come from built-ins and personal skills, pushed in ascending precedence and then
 * collapsed by a single dedup (later push wins on a name collision):
 *   1. Built-in capability skills — always discoverable in agent and no-agent mode.
 *   2. personal   — the user's library: an agent's curated subset (agent.skills),
 *                   or the full library when the personal source is on. Pushed
 *                   last so a personal/curated skill shadows a shipped template of
 *                   the same name.
 *
 * Template content is fetched lazily on `load_skill`; only name/description reach
 * the prompt. Explicit selections extend the same provider for one chat run.
 */
export function useSkillsProvider(
  agent: Agent | null,
  sources: SkillSources,
  activePlugins: InstalledPlugin[] = [],
  installedPlugins: InstalledPlugin[] = activePlugins,
): { provider: SkillsToolProvider | null; forSelection: (names: readonly string[]) => SkillsToolProvider | null } {
  const { skills } = useSkills();
  const { templates, loadTemplate } = useSkillTemplates();

  const result = useMemo(() => {
    // Built-in capabilities are discovered by task, without a mode toggle.
    const entries: SkillEntry[] = builtinTemplateEntries(templates, loadTemplate);
    // 2. Personal library — an agent's curated subset, or the full library.
    const personal = agent ? skills.filter((s) => agent.skills.includes(s.name)) : sources.personal ? skills : [];
    entries.push(...libraryEntries(personal));

    // Single dedup: last push wins, so precedence is exactly the order above.
    const deduped = [...new Map(entries.map((e) => [e.name, e])).values()];

    // Plugin skills are keyed by plugin id, so they never collide with the above.
    const pluginSkills = pluginEntries(activePlugins);

    const meta = {
      id: SKILLS_PROVIDER_ID,
      name: "Skills",
      description: agent ? "Specialized agent skills" : "Available skills",
    };
    const manual = [...libraryEntries(skills), ...pluginEntries(installedPlugins)];
    const forSelection = (names: readonly string[]) => {
      const selected = new Set(names);
      return createSkillsProvider(
        [...deduped, ...pluginSkills, ...manual.filter((entry) => selected.has(skillName(entry)))],
        meta,
      );
    };
    return { provider: forSelection([]), forSelection };
  }, [agent, skills, templates, loadTemplate, sources.personal, activePlugins, installedPlugins]);
  // Editor and voice execution use the automatic selection. Chat runs capture
  // their own provider's loader, so switching chats cannot change their files.
  useEffect(() => {
    setSkillResourceResolver(SKILLS_PROVIDER_ID, result.provider?.loadFiles ?? null);
    return () => setSkillResourceResolver(SKILLS_PROVIDER_ID, null);
  }, [result.provider]);
  return result;
}
