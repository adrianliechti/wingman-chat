import { PencilRuler } from "lucide-react";
import studioInstructionsText from "@/features/studio/prompts/studio.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";

/** Provider id for the unified Studio capability (documents, visuals & images). */
export const STUDIO_PROVIDER_ID = "studio";

/**
 * "Studio" — the single creative-output capability, merging the former Office,
 * Designer, and Image entries. It injects one system prompt (studio.txt):
 * produce real document/slide/sheet/PDF/audio files and visual/interactive
 * artifacts with the Python/JavaScript executors, reading the matching format
 * skill before building.
 *
 * Execution uses the default chat tools and artifacts workspace. Enabling Studio
 * also exposes its skill pack through `read_skill` in either agent or no-agent mode.
 */
const studioProvider: ToolProvider = {
  id: STUDIO_PROVIDER_ID,
  name: "Studio",
  description: "Documents, slides, sheets, visuals & images",
  icon: PencilRuler,
  instructions: studioInstructionsText,
  tools: [],
};

export function useStudioProvider(): ToolProvider {
  return studioProvider;
}
