import { Palette } from "lucide-react";
import { useMemo } from "react";
import designerInstructionsText from "@/features/notebook/prompts/designer.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";

/** Provider id for the Designer capability (the "Designer" entry of the Notebook section). */
export const DESIGNER_PROVIDER_ID = "designer";

/**
 * "Designer" — an instructions-only tool provider that injects the design system
 * prompt (designer.txt): design visual & interactive artifacts (web pages, UIs,
 * posters, diagrams, charts, infographics, generative art) as self-contained HTML
 * or rendered files, reading the matching design/visualize skill before building.
 *
 * Carries no tools of its own; execution is the artifacts interpreter + HTML
 * preview and the global `read_skill` over the Notebook skill pool. The "+" menu
 * pairs this toggle with `skillSources.notebook`.
 */
export function useDesignerProvider(): ToolProvider {
  return useMemo<ToolProvider>(
    () => ({
      id: DESIGNER_PROVIDER_ID,
      name: "Designer",
      description: "Web pages, diagrams, posters & interactive visuals",
      icon: Palette,
      instructions: designerInstructionsText,
      tools: [],
    }),
    [],
  );
}
