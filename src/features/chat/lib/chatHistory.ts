import type { ModelMessage, UIMessage } from "@tanstack/ai";
import { ALREADY_LOADED } from "@tanstack/ai-skills";
import { skillName } from "@/features/skills/lib/skillSource";
import { isMediaPart, isUserPrompt, mediaName, messageMetadata, type MediaPart } from "@/shared/lib/messages";
import { injectRequestContext } from "@/shared/lib/requestContext";

/*
 * The provider view. Every function here takes and returns ModelMessages, the
 * shape TanStack hands middleware before a model call, so no transcript is
 * rebuilt along the way.
 */

/** Tool calls by id across the assistant turns, for results that only carry their call id. */
function toolCallIndex(messages: readonly ModelMessage[]) {
  return new Map(
    messages.flatMap((message) =>
      (message.toolCalls ?? []).map((call) => [call.id, { name: call.function.name, args: call.function.arguments }]),
    ),
  );
}

/**
 * Skill instructions are durable behavioral guidance, so they must survive
 * pruning at the summary marker (agentskills.io "manage skill context over
 * time"). We carry the instructions across as plain assistant text rather than
 * replaying the original call/result pair: a skill read batched with another
 * tool call in the same turn would otherwise have its sibling result pruned,
 * leaving an orphaned function_call the Responses API rejects.
 */
export function preservedSkillMessages(messages: readonly ModelMessage[], only?: ReadonlySet<string>): ModelMessage[] {
  const calls = toolCallIndex(messages);
  const skills = new Map<string, string>();

  for (const message of messages) {
    if (message.role !== "tool" || !message.toolCallId || typeof message.content !== "string") continue;
    if (only && !only.has(message.toolCallId)) continue;
    const call = calls.get(message.toolCallId);
    const tool = message.name ?? call?.name;
    if (tool !== "read_skill" && tool !== "load_skill") continue;

    try {
      const parsed = JSON.parse(message.content);
      const name = tool === "load_skill" ? parsed.skill : parsed.name;
      const instructions = tool === "load_skill" ? parsed.content : parsed.instructions;
      if (typeof name !== "string" || typeof instructions !== "string" || instructions === ALREADY_LOADED) continue;
      // Legacy calls carried plugin identity in the arguments. Native results
      // carry a qualified name, plus compatibility and resource inventories.
      const plugin = tool === "read_skill" && call ? JSON.parse(call.args).plugin : undefined;
      const key = skillName({ name, plugin: typeof plugin === "string" ? plugin : undefined });
      // Refresh insertion order when a skill was read more than once so the
      // most recently loaded instructions win without duplicating them.
      skills.delete(key);
      skills.set(key, tool === "load_skill" ? message.content : instructions);
    } catch {
      // Failed skill reads and legacy non-JSON results are not durable guidance.
    }
  }

  return [...skills].map(([name, instructions]) => ({
    role: "assistant",
    content: `[Active skill: ${name}]\n${instructions}`,
  }));
}

/** Drop messages before the last summary marker so API requests stay small,
 *  carrying skill instructions across as text so they survive compaction. */
export function pruneAtSummary(messages: ModelMessage[]): ModelMessage[] {
  const idx = messages.findLastIndex((message) => message.metadata?.kind === "summary");
  if (idx < 0) return messages;

  const userIndex = messages.findLastIndex(isUserPrompt);
  // A legacy summary can sit inside the current tool loop. Keep the exact
  // human request and any saved runtime feedback alongside it.
  const currentTurn = userIndex >= 0 && userIndex < idx ? messages.slice(userIndex, idx) : [];
  const retained = currentTurn.filter((message, index) => index === 0 || message.metadata?.kind === "runtime_feedback");
  return [messages[idx], ...preservedSkillMessages(messages.slice(0, idx)), ...retained, ...messages.slice(idx + 1)];
}

/** Replace inline images before the latest user message with a placeholder.
 *  They're persisted as artifacts (see useFileAttachments) so the model can
 *  re-read them; dropping the base64 from earlier turns keeps requests small.
 *  Model-bound copy only — stored/displayed messages keep their images. */
export function stripHistoryImages(messages: ModelMessage[]): ModelMessage[] {
  const lastUserIndex = messages.findLastIndex(isUserPrompt);
  if (lastUserIndex <= 0) return messages; // nothing earlier to strip

  let changed = false;
  const result = messages.map((message, index) => {
    if (index >= lastUserIndex || !Array.isArray(message.content)) return message;
    if (!message.content.some((part) => part.type === "image")) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image"
          ? {
              type: "text" as const,
              content: `[image "${mediaName(part) ?? "image"}" omitted to save context — read it from the artifacts workspace if you need it]`,
            }
          : part,
      ),
    };
  });
  return changed ? result : messages;
}

function describeMedia(part: MediaPart): string {
  const kind = part.type === "document" ? "file" : part.type;
  const name = mediaName(part);
  return `[${kind}${name ? ` "${name}"` : ""} omitted from this summary]`;
}

/** Describe media instead of sending it, for prose-only requests such as history
 *  summarization. Those run on `chat.summarizer`, a bare model id with no declared
 *  modality support, and a rejected request would abort the chat run. Attachment
 *  bytes add cost without helping a summary, so only their names carry over.
 *  Model-bound copy only — stored/displayed messages keep their media. */
export function stripMediaContent(messages: ModelMessage[]): ModelMessage[] {
  let changed = false;
  const result = messages.map((message) => {
    if (!Array.isArray(message.content) || !message.content.some(isMediaPart)) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part) =>
        isMediaPart(part) ? { type: "text" as const, content: describeMedia(part) } : part,
      ),
    };
  });
  return changed ? result : messages;
}

/** One model-bound view for requests, context estimates, and compaction checks. */
export function prepareChatMessages(messages: ModelMessage[], context = ""): ModelMessage[] {
  return injectRequestContext(stripHistoryImages(pruneAtSummary(messages)), context);
}

/** What the gateway's classifier and the title prompt receive: plain role/text turns. */
export interface ClassificationMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string }[];
}

/** Recent human/assistant prose for title, category, and risk classification. */
export function sanitizeForClassification(messages: readonly UIMessage[]): ClassificationMessage[] {
  const recent: ClassificationMessage[] = [];

  for (let i = messages.length - 1; i >= 0 && recent.length < 6; i--) {
    const message = messages[i];
    if (message.role === "system" || messageMetadata(message).kind === "runtime_feedback") continue;
    const content = message.parts.flatMap((part): ClassificationMessage["content"] => {
      if (part.type === "text") return [{ type: "text", text: part.content }];
      if (isMediaPart(part)) {
        const kind = part.type === "document" ? "file" : part.type;
        const name = mediaName(part);
        return [{ type: "text", text: `[${kind}${name ? `: ${name}` : ""}]` }];
      }
      return [];
    });
    if (content.length > 0) recent.unshift({ role: message.role, content });
  }

  return recent;
}
