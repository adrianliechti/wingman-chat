import type { ArtifactEditRequest } from "@/features/artifacts/lib/editRequest";
import { Role, type Message } from "@/shared/types/chat";

/** The user message sent when a highlighted passage is edited from the viewer. */
export function buildSelectionEditMessage(request: ArtifactEditRequest): Message {
  return {
    role: Role.User,
    content: [
      { type: "text", text: request.instruction.trim() },
      {
        type: "artifact_selection",
        path: request.path,
        text: request.text,
        ...(request.startLine
          ? { startLine: request.startLine, endLine: request.endLine ?? request.startLine }
          : {}),
      },
    ],
  };
}
