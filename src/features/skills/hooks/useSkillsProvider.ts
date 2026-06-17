import { useMemo } from "react";
import {
  createSkillsProvider,
  isStudioSkillCategory,
  libraryEntries,
  SKILLS_PROVIDER_ID,
  type SkillEntry,
  type SkillSources,
  templateEntries,
} from "@/features/skills/lib/skillsProvider";
import type { ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";
import { useSkillTemplates } from "./useSkillTemplates";

/**
 * Global, user-toggleable Skills tool (mirrors the Web Search tool), available
 * only when no agent is active. It exposes skills from three independently
 * selectable sources (an option of the same tool):
 *
 * - personal — the user's own editable OPFS skills.
 * - catalog  — the shipped template catalog.
 * - studio   — the shipped Studio skill pack.
 *
 * Both can be on at once; a personal skill shadows a template of the same name.
 * Template content is fetched lazily on `read_skill`; only name/description go
 * into the prompt. Shares the "skills" provider id with the agent-scoped
 * provider — they never coexist (this one is registered only with no agent).
 *
 * Returns null when no source is selected or there's nothing to expose.
 */
export function useSkillsProvider(sources: SkillSources): ToolProvider | null {
  const { skills } = useSkills();
  const { templates, loadTemplate } = useSkillTemplates();

  return useMemo<ToolProvider | null>(() => {
    const entries: SkillEntry[] = [];
    // When personal skills are also included, drop templates they shadow by
    // name — the user's editable version wins.
    const shadowNames = sources.personal ? new Set(skills.map((s) => s.name)) : undefined;

    if (sources.personal) {
      entries.push(...libraryEntries(skills));
    }
    // Catalog and Studio split the same template inventory by category so the
    // Studio pack can be toggled independently of the general catalog.
    if (sources.catalog) {
      entries.push(...templateEntries(templates, loadTemplate, (t) => !isStudioSkillCategory(t.category), shadowNames));
    }
    if (sources.studio) {
      entries.push(...templateEntries(templates, loadTemplate, (t) => isStudioSkillCategory(t.category), shadowNames));
    }

    // A name could appear in both the catalog and Studio category groups.
    // Dedupe by name, letting the last push win — Studio is pushed last and is
    // the curated, offline-correct surface — so the prompt list and `read_skill`
    // resolution stay unambiguous when both sources are on.
    const deduped = [...new Map(entries.map((e) => [e.name, e])).values()];

    return createSkillsProvider(deduped, {
      id: SKILLS_PROVIDER_ID,
      name: "Skills",
      description: "Available skills",
    });
  }, [skills, templates, loadTemplate, sources.personal, sources.catalog, sources.studio]);
}
