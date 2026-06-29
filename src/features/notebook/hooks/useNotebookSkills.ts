import { useMemo } from "react";
import { useSkillTemplates } from "@/features/skills/hooks/useSkillTemplates";
import {
  createSkillsProvider,
  isStudioSkillCategory,
  SKILLS_PROVIDER_ID,
  templateEntries,
} from "@/features/skills/lib/skillsProvider";
import type { ToolProvider } from "@/shared/types/chat";

/**
 * Skills provider for the notebook source-chat.
 *
 * Exposes a single `read_skill` surface over the shipped **capability** catalog
 * — every skill except the Studio generator pack, which the notebook's own
 * Studio panel owns — so the assistant can apply domain methods (variance
 * analysis, reconciliation, legal-risk triage, research synthesis, …) while
 * reasoning over the sources. This reuses the exact same catalog and provider
 * the main chat builds in no-agent mode; nothing notebook-specific is invented.
 *
 * Returns `null` when no templates are served, so the caller can fold it in
 * unconditionally and the chat degrades to source-only tools.
 */
export function useNotebookSkills(): ToolProvider | null {
  const { templates, loadTemplate } = useSkillTemplates();

  return useMemo(() => {
    const entries = templateEntries(templates, loadTemplate, (t) => !isStudioSkillCategory(t.category));
    return createSkillsProvider(entries, {
      id: SKILLS_PROVIDER_ID,
      name: "Skills",
      description: "Domain methods for analyzing your sources",
    });
  }, [templates, loadTemplate]);
}
