import { ALREADY_LOADED } from "@tanstack/ai-skills";
import { skillName } from "@/features/skills/lib/skillSource";
import { injectRequestContext, isUserMessage } from "@/shared/lib/requestContext";
import { Role, type Content, type Message, type TextContent } from "@/shared/types/chat";

/**
 * Skill instructions are durable behavioral guidance, so they must survive
 * pruning at the summary marker (agentskills.io "manage skill context over
 * time"). We carry the instructions across as plain assistant text rather than
 * replaying the original tool_call/tool_result pair: a skill read batched with
 * another tool call in the same turn would otherwise have its sibling result
 * pruned, leaving an orphaned function_call the Responses API rejects.
 */
export function preservedSkillMessages(messages: Message[]): Message[] {
  const skills = new Map<string, string>();

  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool_result" || (part.name !== "read_skill" && part.name !== "load_skill")) continue;
      const raw = part.result.find((item): item is TextContent => item.type === "text")?.text;
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const name = part.name === "load_skill" ? parsed.skill : parsed.name;
        const instructions = part.name === "load_skill" ? parsed.content : parsed.instructions;
        if (typeof name !== "string" || typeof instructions !== "string" || instructions === ALREADY_LOADED) continue;
        // Legacy calls carried plugin identity in the arguments. Native results
        // carry a qualified name, plus compatibility and resource inventories.
        const plugin = part.name === "read_skill" ? JSON.parse(part.arguments).plugin : undefined;
        const key = skillName({ name, plugin: typeof plugin === "string" ? plugin : undefined });
        // Refresh insertion order when a skill was read more than once so the
        // most recently loaded instructions win without duplicating them.
        skills.delete(key);
        skills.set(key, part.name === "load_skill" ? raw : instructions);
      } catch {
        // Failed skill reads and legacy non-JSON results are not durable guidance.
      }
    }
  }

  return [...skills].map(([name, instructions]) => ({
    role: Role.Assistant,
    content: [{ type: "text", text: `[Active skill: ${name}]\n${instructions}` }],
  }));
}

/** Drop messages before the last summary marker so API requests stay small,
 *  carrying skill instructions across as text so they survive compaction. */
export function pruneAtSummary(messages: Message[]): Message[] {
  const idx = messages.findLastIndex((m) => m.content.some((p) => p.type === "summary"));
  if (idx < 0) return messages;

  const userIndex = messages.findLastIndex(isUserMessage);
  // A legacy summary can sit inside the current tool loop. Keep the exact
  // human request and any saved runtime feedback alongside it.
  const currentTurn = userIndex >= 0 && userIndex < idx ? messages.slice(userIndex, idx) : [];
  const retained = currentTurn.filter(
    (message, index) => index === 0 || message.content.some((part) => part.type === "runtime_feedback"),
  );
  return [messages[idx], ...preservedSkillMessages(messages.slice(0, idx)), ...retained, ...messages.slice(idx + 1)];
}

/** Replace inline images before the latest user message with a placeholder.
 *  They're persisted as artifacts (see useFileAttachments) so the model can
 *  re-read them; dropping the base64 from earlier turns keeps requests small.
 *  Model-bound copy only — stored/displayed messages keep their images. */
export function stripHistoryImages(messages: Message[]): Message[] {
  const lastUserIndex = messages.findLastIndex(isUserMessage);
  if (lastUserIndex <= 0) return messages; // nothing earlier to strip

  let changed = false;
  const result = messages.map((message, index) => {
    if (index >= lastUserIndex || !message.content.some((p) => p.type === "image")) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image"
          ? ({
              type: "text",
              text: `[image "${part.name ?? "image"}" omitted to save context — read it from the artifacts workspace if you need it]`,
            } satisfies TextContent)
          : part,
      ),
    };
  });
  return changed ? result : messages;
}

/** One model-bound view for requests, context estimates, and compaction checks. */
export function prepareChatMessages(messages: Message[], context = ""): Message[] {
  return injectRequestContext(stripHistoryImages(pruneAtSummary(messages)), context);
}

/** Retry resumes committed work, including tool results and summary markers. */
export function historyForRetry(messages: Message[]): Message[] | null {
  const last = messages.at(-1);
  if (last?.role !== Role.Assistant || !last.error) return null;
  const history = messages.slice(0, -1);
  return history.some(isUserMessage) ? history : null;
}

function mediaPlaceholder(part: { type: string; name?: string }): TextContent {
  return {
    type: "text",
    text: `[${part.type}${part.name ? `: ${part.name}` : ""}]`,
  };
}

/** Recent human/assistant prose for title, category, and risk classification. */
export function sanitizeForClassification(messages: Message[]): Message[] {
  const recent: Message[] = [];

  for (let i = messages.length - 1; i >= 0 && recent.length < 6; i--) {
    const message = messages[i];
    const content = message.content.flatMap((part): Content[] => {
      if (part.type === "text" || part.type === "summary") return [part];
      if (part.type === "image" || part.type === "audio" || part.type === "file") {
        return [mediaPlaceholder(part)];
      }
      return [];
    });
    if (content.length > 0) recent.unshift({ role: message.role, content });
  }

  return recent;
}
