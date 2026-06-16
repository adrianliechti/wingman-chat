import { Notebook } from "lucide-react";
import { useMemo } from "react";
import notebookInstructionsText from "@/features/notebook/prompts/notebook.txt?raw";
import type { ToolProvider } from "@/shared/types/chat";

/** Provider id for the Notebook generation capability (toggled like Web Search). */
export const NOTEBOOK_PROVIDER_ID = "notebook";

/**
 * The "Notebook" capability: an instructions-only tool provider that injects the
 * generation system prompt (notebook.txt) teaching the model to produce real
 * deliverables — docs, decks, sheets, PDFs, visuals — with the always-on Python
 * interpreter, reading the matching office/design skill before building.
 *
 * It carries no tools of its own; execution is the artifacts interpreter and the
 * global `read_skill` over the Notebook skill set. The chat "+" menu pairs this
 * toggle with `skillSources.notebook` so both turn on together.
 */
export function useNotebookGuideProvider(): ToolProvider {
  return useMemo<ToolProvider>(
    () => ({
      id: NOTEBOOK_PROVIDER_ID,
      name: "Notebook",
      description: "Create polished docs, decks, sheets & visuals",
      icon: Notebook,
      instructions: notebookInstructionsText,
      tools: [],
    }),
    [],
  );
}
