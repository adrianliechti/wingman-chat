import { useQuery } from "@tanstack/react-query";
import { loadSkillTemplate, type SkillTemplate, skillTemplatesQuery } from "@/features/skills/lib/templates";
import { queryClient } from "@/shared/lib/queryClient";

const EMPTY_TEMPLATES: SkillTemplate[] = [];

/**
 * The skill inventory served at `/skills`, shared with helper code through the
 * query client. `loadTemplate` lazily fetches and parses a single template's SKILL.md.
 */
export function useSkillTemplates() {
  const { data } = useQuery(skillTemplatesQuery, queryClient);
  return { templates: data ?? EMPTY_TEMPLATES, loadTemplate: loadSkillTemplate };
}
