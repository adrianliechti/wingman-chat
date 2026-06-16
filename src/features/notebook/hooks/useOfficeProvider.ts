import { FileText } from "lucide-react";
import { useMemo } from "react";
import officeInstructionsText from "@/features/notebook/prompts/office.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";

/** Provider id for the Office capability (the "Office" entry of the Notebook section). */
export const OFFICE_PROVIDER_ID = "office";

/**
 * "Office" — an instructions-only tool provider that injects the office system
 * prompt (office.txt): produce real document/slide/sheet/PDF/audio files with the
 * always-on Python interpreter, reading the matching format skill before building.
 *
 * Carries no tools of its own; execution is the artifacts interpreter and the
 * global `read_skill` over the Notebook skill pool. The "+" menu pairs this toggle
 * with `skillSources.notebook` so the skills surface alongside the instructions.
 */
export function useOfficeProvider(): ToolProvider {
  return useMemo<ToolProvider>(
    () => ({
      id: OFFICE_PROVIDER_ID,
      name: "Office",
      description: "Documents, slides, spreadsheets & PDFs",
      icon: FileText,
      instructions: officeInstructionsText,
      tools: [],
    }),
    [],
  );
}
