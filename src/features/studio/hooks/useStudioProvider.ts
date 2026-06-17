import { PencilRuler } from "lucide-react";
import { useMemo } from "react";
import { useImageTool } from "@/features/studio/hooks/useImageTool";
import studioInstructionsText from "@/features/studio/prompts/studio.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";

/** Provider id for the unified Studio capability (documents, visuals & images). */
export const STUDIO_PROVIDER_ID = "studio";

/**
 * "Studio" — the single creative-output capability, merging the former Office,
 * Designer, and Image entries. It injects one system prompt (studio.txt):
 * produce real document/slide/sheet/PDF/audio files and visual/interactive
 * artifacts with the always-on Python interpreter, reading the matching format
 * skill before building.
 *
 * Carries the `create_image` tool when a renderer is configured; its other
 * execution is the artifacts interpreter + HTML preview and the global
 * `read_skill` over the shipped Notebook skill pack. Toggling it pairs with that
 * skill source (no agent) / merges the pack into the agent skills (agent mode),
 * so the skills surface alongside the instructions in either case.
 */
export function useStudioProvider(): ToolProvider {
  const imageTool = useImageTool();

  return useMemo<ToolProvider>(
    () => ({
      id: STUDIO_PROVIDER_ID,
      name: "Studio",
      description: "Documents, slides, sheets, visuals & images",
      icon: PencilRuler,
      instructions: studioInstructionsText,
      tools: imageTool ? [imageTool] : [],
    }),
    [imageTool],
  );
}
