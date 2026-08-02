import { formatArtifactReference, parseArtifactReference } from "../components/chatMessageUtils";
import type { Content, Message, TextContent } from "@/shared/types/chat";
import { Role, withMessageIdentity } from "@/shared/types/chat";

export interface QueuedSend {
  id: string;
  chatId: string;
  message: Message;
  status: "queued" | "held";
  createdAt: string;
}

/** Merge queued prompts into one new turn without duplicating attachment references. */
export function mergeQueuedMessages(items: QueuedSend[]): Message {
  const textBlocks: string[] = [];
  const otherContent: Content[] = [];
  const artifactPaths = new Set<string>();
  const explicitArtifactRefs = new Map<string, Extract<Content, { type: "artifact_ref" }>>();

  for (const item of items) {
    const messageText: string[] = [];
    for (const part of item.message.content) {
      if (part.type === "text") {
        const paths = parseArtifactReference(part.text);
        if (paths.length > 0) {
          for (const path of paths) artifactPaths.add(path);
        } else if (part.text.trim()) {
          messageText.push(part.text.trim());
        }
      } else if (part.type === "artifact_ref") {
        artifactPaths.add(part.path);
        if (!explicitArtifactRefs.has(part.path)) explicitArtifactRefs.set(part.path, part);
      } else if (part.type !== "tool_call" && part.type !== "tool_result" && part.type !== "reasoning") {
        otherContent.push(part);
      }
    }
    if (messageText.length > 0) textBlocks.push(messageText.join("\n"));
  }

  const content: Content[] = [];
  if (textBlocks.length > 0) content.push({ type: "text", text: textBlocks.join("\n\n") } satisfies TextContent);
  content.push(...otherContent);
  content.push(...explicitArtifactRefs.values());
  const legacyPaths = [...artifactPaths].filter((path) => !explicitArtifactRefs.has(path));
  if (legacyPaths.length > 0) {
    content.push({ type: "text", text: formatArtifactReference(legacyPaths) });
  }

  return withMessageIdentity({ role: Role.User, content });
}

export function queuedSend(chatId: string, message: Message): QueuedSend {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    chatId,
    message: withMessageIdentity(message),
    status: "queued",
    createdAt,
  };
}
