import type { ChatMiddleware } from "@tanstack/ai";
import type { AgentMessageMetadata } from "@/shared/lib/agent";
import { isUserMessage } from "@/shared/lib/requestContext";
import { artifactDeltaFromMeta, type ArtifactMutation } from "@/shared/types/artifact";
import type { Message } from "@/shared/types/chat";
import { verifyArtifacts } from "./artifact-verifier";
import type { FileSystemManager } from "./fs";

/** Verification feeds the next native model turn; repairs are ordinary tool calls. */
export function artifactVerification(
  fs: FileSystemManager,
  metadata: Pick<AgentMessageMetadata, "toolMeta">,
  messages: Message[],
): ChatMiddleware {
  const paths = new Set<string>();
  let dirty = false;
  let feedback = "";
  const track = (mutations: ArtifactMutation[]) => {
    for (const mutation of mutations) {
      dirty = true;
      for (const path of paths) {
        if (
          path === mutation.path || path.startsWith(`${mutation.path}/`) ||
          (mutation.from && (path === mutation.from || path.startsWith(`${mutation.from}/`)))
        ) paths.delete(path);
      }
      if (mutation.operation !== "delete") paths.add(mutation.path);
    }
  };
  // Restore the current turn once, including writes completed before an
  // interrupt/reload. Later tool phases use their result IDs, not history scans.
  for (const message of messages.slice(messages.findLastIndex(isUserMessage) + 1)) {
    for (const part of message.content) {
      if (part.type === "tool_result") track(artifactDeltaFromMeta(part.meta)?.mutations ?? []);
    }
  }
  return {
    name: "workspace-verification",
    onToolPhaseComplete: (_ctx, { results }) => {
      for (const { toolCallId } of results) {
        track(artifactDeltaFromMeta(metadata.toolMeta(toolCallId))?.mutations ?? []);
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
      if (feedback) return {
        providerMessages: [...(config.providerMessages ?? config.messages), { role: "user", content: feedback }],
      };
    },
  };
}
