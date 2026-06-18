import { useMemo } from "react";
import type { Agent } from "@/features/agent/types/agent";
import {
  createSkillsProvider,
  isStudioSkillCategory,
  libraryEntries,
  SKILLS_PROVIDER_ID,
  type SkillEntry,
  type SkillSources,
  studioTemplateEntries,
  templateEntries,
} from "@/features/skills/lib/skillsProvider";
import type { ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";
import { useSkillTemplates } from "./useSkillTemplates";

/**
 * The app's single Skills tool provider — one `read_skill` surface for every mode.
 * The agent and no-agent cases are the same provider with different inputs (not
 * two providers sharing an id), so a duplicate `read_skill` can never arise.
 *
 * Entries come from up to three sources, pushed in ascending precedence and then
 * collapsed by a single dedup (later push wins on a name collision):
 *   1. catalog    — shipped templates, no-agent only (agents don't expose it)
 *   2. Studio pack — format/medium + generator skills, whenever the Studio
 *                    capability is on (agent or no-agent)
 *   3. personal   — the user's library: an agent's curated subset (agent.skills),
 *                   or the full library when the personal source is on. Pushed
 *                   last so a personal/curated skill shadows a shipped template of
 *                   the same name.
 *
 * Template content is fetched lazily on `read_skill`; only name/description reach
 * the prompt. Returns null when there's nothing to expose.
 */
export function useSkillsProvider(
  agent: Agent | null,
  sources: SkillSources,
  studioEnabled: boolean,
): ToolProvider | null {
  const { skills } = useSkills();
  const { templates, loadTemplate } = useSkillTemplates();

  return useMemo<ToolProvider | null>(() => {
    const entries: SkillEntry[] = [];

    // 1. General catalog — no-agent only.
    if (!agent && sources.catalog) {
      entries.push(...templateEntries(templates, loadTemplate, (t) => !isStudioSkillCategory(t.category)));
    }
    // 2. Studio skill pack — whenever the capability is on, in either mode.
    if (studioEnabled) {
      entries.push(...studioTemplateEntries(templates, loadTemplate));
    }
    // 3. Personal library — an agent's curated subset, or the full library.
    const personal = agent ? skills.filter((s) => agent.skills.includes(s.name)) : sources.personal ? skills : [];
    entries.push(...libraryEntries(personal));

    // Single dedup: last push wins, so precedence is exactly the order above.
    const deduped = [...new Map(entries.map((e) => [e.name, e])).values()];

    return createSkillsProvider(deduped, {
      id: SKILLS_PROVIDER_ID,
      name: "Skills",
      description: agent ? "Specialized agent skills" : "Available skills",
    });
  }, [agent, skills, templates, loadTemplate, sources.personal, sources.catalog, studioEnabled]);
}
