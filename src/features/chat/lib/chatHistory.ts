import type { Client } from "@/shared/lib/client";
import { isAbortError } from "@/shared/lib/errors";
import { clearReplayableReasoning, isReplayableReasoning } from "@/shared/lib/reasoning";
import { injectRequestContext, isUserMessage } from "@/shared/lib/requestContext";
import { trimBulkyToolHistory } from "@/shared/lib/toolHistoryTrim";
import { serializeToolResultForApi } from "@/shared/lib/utils";
import { Role, withMessageIdentity, type Content, type Message, type TextContent } from "@/shared/types/chat";

/** Messages from the last summary marker onward — the window actually sent to the model. */
function messagesSinceSummary(messages: Message[]): Message[] {
  const idx = messages.findLastIndex((m) => m.content.some((p) => p.type === "summary"));
  return idx > 0 ? messages.slice(idx) : messages;
}

/**
 * Skill instructions are durable behavioral guidance, so they must survive
 * pruning at the summary marker (agentskills.io "manage skill context over
 * time"). We carry the instructions across as plain assistant text rather than
 * replaying the original tool_call/tool_result pair: a skill read batched with
 * another tool call in the same turn would otherwise have its sibling result
 * pruned, leaving an orphaned function_call the Responses API rejects.
 */
function preservedSkillMessages(messages: Message[]): Message[] {
  const skills = new Map<string, string>();

  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool_result" || part.name !== "read_skill") continue;
      const raw = part.result.find((item): item is TextContent => item.type === "text")?.text;
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as { name?: unknown; instructions?: unknown };
        if (typeof parsed.name !== "string" || typeof parsed.instructions !== "string") continue;
        // Refresh insertion order when a skill was read more than once so the
        // most recently loaded instructions win without duplicating them.
        skills.delete(parsed.name);
        skills.set(parsed.name, parsed.instructions);
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
  // Emergency compaction can condense the current tool loop. Keep the exact
  // human request and internal stop-policy feedback alongside its summary.
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
  return injectRequestContext(stripHistoryImages(trimBulkyToolHistory(pruneAtSummary(messages))), context);
}

/** Retry resumes committed work, including tool results and summary markers. */
export function historyForRetry(messages: Message[]): Message[] | null {
  const last = messages.at(-1);
  if (last?.role !== Role.Assistant || !last.error) return null;
  const history = messages.slice(0, -1);
  return history.some(isUserMessage) ? history : null;
}

/** Unknown context modes conservatively include all replayable reasoning. */
function reasoningStart(messages: Message[]): number {
  const usage = messages.findLast((message) => message.role === Role.Assistant)?.usage;
  return usage?.reasoningContext === "current_turn" ? Math.max(0, messages.findLastIndex(isUserMessage)) : 0;
}

/**
 * Rough token estimate (chars / 4) excluding binary attachments. Use measured
 * reasoning tokens where available; otherwise approximate the retained payload.
 */
function estimateTokens(messages: Message[], reasoningFrom = reasoningStart(messages)): number {
  let chars = 0;
  let reasoningTokens = 0;
  for (const [index, msg] of messages.entries()) {
    const reasoning = msg.content.filter(isReplayableReasoning);
    if (index >= reasoningFrom && reasoning.length > 0) {
      // Older gateways reported zero when the provider had no breakdown.
      // A signed payload still needs an estimate in that case.
      reasoningTokens +=
        msg.usage?.reasoningTokens && msg.usage.reasoningTokens > 0
          ? msg.usage.reasoningTokens
          : Math.ceil(
              reasoning.reduce(
                (total, part) =>
                  total + Math.max(part.text.length, part.summary?.length ?? 0, part.encryptedContent.length),
                0,
              ) / 4,
            );
    }
    for (const part of msg.content) {
      if (part.type === "text" || part.type === "summary") {
        chars += part.text.length;
      } else if (part.type === "runtime_feedback") {
        chars += part.text.length;
      } else if (part.type === "artifact_ref") {
        chars += part.path.length + (part.displayName?.length ?? 0) + (part.revision?.length ?? 0) + 24;
      } else if (part.type === "tool_call") {
        chars += part.name.length + part.arguments.length;
      } else if (part.type === "tool_result") {
        for (const r of part.result) {
          if (r.type === "text") chars += r.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4) + reasoningTokens;
}

function mediaPlaceholder(part: { type: string; name?: string }): TextContent {
  return {
    type: "text",
    text: `[${part.type}${part.name ? `: ${part.name}` : ""}]`,
  };
}

/**
 * Wire-style view of messages for the summarizer: opaque reasoning is dropped
 * and binary payloads become short placeholders —
 * JSON.stringifying megabytes of base64 into the helper-model prompt would
 * dwarf the history it's supposed to condense.
 */
export function sanitizeForSummary(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.flatMap((part): Content[] => {
      switch (part.type) {
        case "reasoning":
          return [];
        case "image":
        case "audio":
        case "file":
          return [mediaPlaceholder(part)];
        case "tool_result":
          // arguments duplicate the paired tool_call and are only used by the
          // UI. Results use the same compact representation as the API wire.
          const output = serializeToolResultForApi(part.result);
          return [
            {
              type: "tool_result",
              id: part.id,
              name: part.name,
              arguments: "",
              result: output ? [{ type: "text", text: output }] : [],
            },
          ];
        default:
          return [part];
      }
    }),
  }));
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

function estimateWindowTokens(window: Message[]): number {
  const reasoningFrom = reasoningStart(window);
  for (let i = window.length - 1; i >= 0; i--) {
    const message = window[i];
    const usage = message.usage;
    if (message.role === Role.Assistant && usage?.inputTokens) {
      const omittedReasoning =
        i >= reasoningFrom && message.content.some(isReplayableReasoning) ? 0 : (usage.reasoningTokens ?? 0);
      // A new human turn also removes the prior tool loop's reasoning from
      // the measured input. Subtract only measured counts, keeping attachment
      // and other input costs that a character estimate cannot recover.
      const priorTurn = window.slice(0, i);
      const omittedInputReasoning =
        i < reasoningFrom
          ? priorTurn
              .slice(Math.max(0, priorTurn.findLastIndex(isUserMessage)))
              .reduce(
                (total, prior) =>
                  total + (prior.content.some(isReplayableReasoning) ? (prior.usage?.reasoningTokens ?? 0) : 0),
                0,
              )
          : 0;
      const anchor =
        Math.max(0, usage.inputTokens - omittedInputReasoning) +
        Math.max(0, (usage.outputTokens ?? 0) - omittedReasoning);
      return Math.max(
        anchor + estimateTokens(window.slice(i + 1), Math.max(0, reasoningFrom - i - 1)),
        estimateTokens(window, reasoningFrom),
      );
    }
  }
  return estimateTokens(window);
}

/**
 * Insert a summary marker before the current turn when the active context —
 * everything since the last summary marker, gauged as the wire sees it (after
 * bulky-tool trimming) — exceeds `threshold` estimated tokens. Original
 * user/assistant messages stay in storage (the UI still shows them); only the
 * API request gets pruned at the marker by `pruneAtSummary`. The summarizer
 * reads just the active window: the previous marker is that window's first
 * message, so summaries chain instead of re-reading the whole stored history
 * on every compaction. Any prior marker is dropped from storage so they don't
 * stack.
 */
export async function compactIfNeeded(
  conversation: Message[],
  options: {
    threshold: number;
    client: Pick<Client, "summarizeHistory">;
    summarizerModel: string;
    fallbackModel: string;
    signal?: AbortSignal;
    force?: boolean;
  },
): Promise<Message[]> {
  const { threshold, client, summarizerModel, fallbackModel, signal, force } = options;
  signal?.throwIfAborted();
  if (!(threshold > 0) || conversation.length < 2) return conversation;
  // Gauge only the active window (since the last summary) — measuring full
  // storage (kept intact for the UI) would never drop back under the threshold,
  // so we'd re-summarize on every turn.
  const window = messagesSinceSummary(conversation);
  const prepared = prepareChatMessages(conversation);
  if (!force && estimateWindowTokens(prepared) < threshold) return conversation;

  // Proactive compaction preserves the entire current human turn. On overflow,
  // all completed exchanges may be summarized: requests happen between tool
  // batches, so this never strands an output without its call. pruneAtSummary
  // restores the human request verbatim even when it precedes the new marker.
  const boundary = force ? window.length : window.findLastIndex(isUserMessage);
  if (boundary <= 0) return conversation;
  // Tool dumps may be the reason the request overflowed. Summarize previews,
  // otherwise the summarizer (including the fallback) can overflow as well.
  const toSummarize = trimBulkyToolHistory(window.slice(0, boundary), { recentTurns: 0 });
  if (toSummarize.length === 0) return conversation;

  console.log(
    `[Summary] Compacting ${toSummarize.length} messages (~${estimateTokens(toSummarize)} est. tokens, threshold ${threshold})`,
  );

  const payload = sanitizeForSummary(toSummarize);
  let summary: string;
  try {
    summary = await client.summarizeHistory(summarizerModel, payload, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    if (isAbortError(error)) throw error;
    // A configured summarizer can be a small-window model that chokes on a
    // large window. The chat model just handled this same content, so retry
    // there rather than leaving the conversation permanently uncompactable.
    if (summarizerModel === fallbackModel) throw error;
    console.warn(`[Summary] summarizer ${summarizerModel} failed, retrying with ${fallbackModel}`, error);
    summary = await client.summarizeHistory(fallbackModel, payload, { signal });
  }
  signal?.throwIfAborted();
  summary = summary.trim();
  if (!summary) return conversation;

  const summaryMsg = withMessageIdentity({
    role: Role.Assistant,
    content: [{ type: "summary", text: summary }],
  });
  // Keep visible history in storage, releasing payloads superseded by the new
  // summary. Reasoning in the retained current turn stays available for replay.
  // Strip prior summary markers; pruneAtSummary slices at the latest one.
  const storageBoundary = conversation.length - window.length + boundary;
  const preserved = conversation.slice(0, storageBoundary).flatMap((message) => {
    if (!message.content.some((part) => part.type === "summary")) return [message];
    const content = message.content.filter((part) => part.type !== "summary");
    return content.length ? [{ ...message, content }] : [];
  });
  const compacted = [...clearReplayableReasoning(preserved), summaryMsg, ...conversation.slice(storageBoundary)];
  // A verbose or repeated summary must not create an endless recovery loop.
  return estimateTokens(prepareChatMessages(compacted)) < estimateTokens(prepared) ? compacted : conversation;
}
