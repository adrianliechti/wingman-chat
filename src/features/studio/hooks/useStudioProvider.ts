import { PencilRuler } from "lucide-react";
import { useMemo, useRef } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { ArtifactJobSchema } from "@/shared/types/artifact";
import { upsertArtifactJob } from "@/features/artifacts/lib/artifact-job-store";
import { useImageTool } from "@/features/studio/hooks/useImageTool";
import { useQuestionsTool } from "@/features/studio/hooks/useQuestionsTool";
import { ARTIFACT_DECLARATION_PARAMETERS } from "@/features/studio/lib/artifactDeclarationSchema";
import studioInstructionsText from "@/features/studio/prompts/studio.txt?raw";
import type { Tool, ToolProvider } from "@/shared/types/chat";

/** Provider id for the unified Studio capability (documents, visuals & images). */
export const STUDIO_PROVIDER_ID = "studio";

/**
 * "Studio" — the single creative-output capability, merging the former Office,
 * Designer, and Image entries. It injects one system prompt (studio.txt):
 * produce real document/slide/sheet/PDF/audio files and visual/interactive
 * artifacts with the Python/JavaScript executors, reading the matching format
 * skill before building.
 *
 * Carries the `create_image` tool when a renderer is configured and the always-on
 * `ask_questions` tool for structured discovery rounds; its other execution is the
 * artifacts interpreter + HTML preview and `read_skill` over the shipped Studio
 * skill pack. Enabling the capability sets `studioEnabled`, which useSkillsProvider
 * reads to fold the pack into the single Skills tool (in either agent or no-agent
 * mode), so the skills surface alongside the instructions.
 */
export function useStudioProvider(): ToolProvider {
  const imageTool = useImageTool();
  const questionsTool = useQuestionsTool();
  const { fs } = useArtifacts();
  const fsRef = useRef(fs);
  fsRef.current = fs;

  return useMemo<ToolProvider>(() => {
    const declareArtifact: Tool = {
      name: "declare_artifact",
      title: "Declare artifact",
      description:
        "Declare the primary deliverable after gathering content and loading the relevant skill, before writing files. The runtime uses this for lineage and verification.",
      // This joins the already broad artifact toolbox; runtime validation below
      // keeps it portable without adding another provider-compiled schema.
      strict: false,
      parameters: ARTIFACT_DECLARATION_PARAMETERS,
      function: async (args, context) => {
        const activeFs = fsRef.current;
        if (!activeFs) {
          return [{ type: "text", text: JSON.stringify({ error: "Artifact workspace unavailable" }) }];
        }
        const now = new Date().toISOString();
        const expected = {
          ...(typeof args.expectedUnits === "number" && args.expectedUnits > 0 ? { units: args.expectedUnits } : {}),
          ...(typeof args.width === "number" && args.width > 0 ? { width: args.width } : {}),
          ...(typeof args.height === "number" && args.height > 0 ? { height: args.height } : {}),
        };
        const job = ArtifactJobSchema.parse({
          id: crypto.randomUUID(),
          chatId: activeFs.chatId,
          runId: context?.runId,
          kind: args.kind,
          primaryPath: args.primaryPath,
          expected: Object.keys(expected).length ? expected : undefined,
          phase: "planning",
          revisionOf: typeof args.revisionOf === "string" && args.revisionOf ? args.revisionOf : undefined,
          variantOf: typeof args.variantOf === "string" && args.variantOf ? args.variantOf : undefined,
          sourceRefs: Array.isArray(args.sourceRefs)
            ? args.sourceRefs.filter((value): value is string => typeof value === "string")
            : [],
          createdAt: now,
          updatedAt: now,
        });
        await upsertArtifactJob(activeFs.chatId, job);
        context?.setMeta?.({ artifactJob: { id: job.id, phase: job.phase, primaryPath: job.primaryPath } });
        return [{ type: "text", text: JSON.stringify({ success: true, job }) }];
      },
    };

    return {
      id: STUDIO_PROVIDER_ID,
      name: "Studio",
      description: "Documents, slides, sheets, visuals & images",
      icon: PencilRuler,
      instructions: studioInstructionsText,
      tools: imageTool ? [declareArtifact, imageTool, questionsTool] : [declareArtifact, questionsTool],
    };
  }, [imageTool, questionsTool]);
}
