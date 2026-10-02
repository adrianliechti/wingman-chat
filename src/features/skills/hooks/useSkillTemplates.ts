import { useEffect, useState } from "react";
import { loadSkillTemplate, loadSkillTemplates, type SkillTemplate } from "@/features/skills/lib/templates";

/**
 * Loads the skill inventory served at `/skills`.
 * `loadTemplate` lazily fetches and parses a single template's SKILL.md.
 */
export function useSkillTemplates() {
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadSkillTemplates()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loadTemplate: loadSkillTemplate };
}
