import type { UIMessage } from "@tanstack/ai";
import type { ArtifactEditRequest } from "@/features/artifacts/lib/editRequest";
import { artifactSelectionPart, text, userMessage } from "@/shared/lib/messages";

/** The user message sent when a highlighted passage is edited from the viewer. */
export function buildSelectionEditMessage(request: ArtifactEditRequest): UIMessage {
  return userMessage([
    text(request.instruction.trim()),
    artifactSelectionPart({
      path: request.path,
      text: request.text,
      ...(request.startLine ? { startLine: request.startLine, endLine: request.endLine ?? request.startLine } : {}),
    }),
  ]);
}
