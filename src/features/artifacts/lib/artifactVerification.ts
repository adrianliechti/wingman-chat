import type { ChatMiddleware, UIMessage } from "@tanstack/ai";
import type { RunSidecar } from "@/shared/lib/agent";
import { isUserPrompt, toolResultMetadata } from "@/shared/lib/messages";
import { artifactDeltaFromMeta, updateArtifactPaths } from "@/shared/types/artifact";
import { verifyArtifacts } from "./artifact-verifier";
import type { FileSystemManager } from "./fs";

/** Verification feeds the next native model turn; repairs are ordinary tool calls. */
export function artifactVerification(
  fs: FileSystemManager,
  sidecar: Pick<RunSidecar, "toolMeta">,
  messages: UIMessage[],
): ChatMiddleware {
  const paths = new Set<string>();
  let dirty = false;
  let feedback = "";
  const track = (meta: Record<string, unknown> | undefined) => {
    const mutations = artifactDeltaFromMeta(meta)?.mutations ?? [];
    if (!mutations.length) return;
    dirty = true;
    updateArtifactPaths(paths, mutations);
  };
  // Restore the current turn once, including writes completed before an
  // interrupt/reload. Later tool phases use their result IDs, not history scans.
  for (const message of messages.slice(messages.findLastIndex(isUserPrompt) + 1)) {
    for (const part of message.parts) {
      if (part.type === "tool-result") track(toolResultMetadata(part).meta);
    }
  }
  return {
    name: "workspace-verification",
    onToolPhaseComplete: (_ctx, { results }) => {
      for (const { toolCallId } of results) {
        track(sidecar.toolMeta(toolCallId));
      }
    },
    onConfig: async (ctx, config) => {
      if (ctx.phase !== "beforeModel") return;
      if (dirty) {
        ctx.signal?.throwIfAborted();
        feedback = "";
        if (paths.size) {
          try {
            const checks = await verifyArtifacts(fs, paths, ctx.signal);
            ctx.signal?.throwIfAborted();
            const findings = checks.filter((item) => item.status !== "pass");
            feedback = findings.length
              ? "Workspace verification findings. Fix failed checks with the available tools before finishing. " +
                "If you cannot fix them, explain the remaining issues to the user. Warnings describe verification limits.\n" +
                findings.map((item) => `- [${item.status}] ${item.scope} (${item.id}): ${item.message}`).join("\n")
              : "Workspace verification passed for the files changed in this turn.";
          } catch (error) {
            ctx.signal?.throwIfAborted();
            feedback = `Workspace verification could not complete. Explain this limitation to the user: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        dirty = false;
      }
      if (!feedback) return;
      return {
        providerMessages: [...(config.providerMessages ?? config.messages), { role: "user", content: feedback }],
      };
    },
  };
}
