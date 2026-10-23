import instructions from "../prompts/summarize-history.txt?raw";
import { chat, MetadataCapability, provideMetadata, type MetadataStore, type ChatMiddleware } from "@tanstack/ai";
import {
  clearToolResults,
  composeStrategies,
  estimateMessageTokens,
  summarizeOldest,
  withCompaction,
} from "@tanstack/ai-compaction";
import { followAbortSignal } from "@/shared/lib/abortSignals";
import type { Client } from "@/shared/lib/client";
import { aiTelemetry } from "@/shared/lib/otel";
import { describeToolMessages } from "@/shared/lib/messages";
import { preservedSkillMessages, stripMediaContent } from "./chatHistory";

/** Native provider-context compaction; saved messages and tool results stay complete. */
export function chatCompaction(
  client: Client,
  maxTokens: number,
  model: string,
  signal?: AbortSignal,
  metadata?: MetadataStore,
): ChatMiddleware {
  const strategy = composeStrategies(
    clearToolResults(),
    summarizeOldest({
      summarize: async (messages, input) => {
        const { controller: abortController, cleanup } = followAbortSignal(signal, input.signal);
        try {
          const telemetry = aiTelemetry("summarize_history");
          const result = await chat({
            threadId: `${input.threadId}:compaction`,
            adapter: client.textAdapter(model, signal, telemetry.requestContext),
            // A compacted prefix often ends with an assistant/tool turn.
            // Request a new summary instead of an assistant prefill, which
            // several gateway providers reject.
            messages: [
              // Compaction sees canonical storage references, so the prefix
              // still points at chat blobs the gateway cannot resolve.
              ...stripMediaContent(describeToolMessages(messages)),
              { role: "user", content: "Summarize the preceding conversation." },
            ],
            systemPrompts: [instructions],
            middleware: [telemetry],
            stream: false,
            abortController,
          });
          return result.text;
        } finally {
          cleanup();
        }
      },
    }),
  );
  const compaction = withCompaction({
    maxTokens,
    strategyKey: `wingman-summary-v3:${model}:${instructions}`,
    // The provider reads descriptions of tool media; their bytes are not prompt tokens.
    estimateTokens: (message) => estimateMessageTokens(describeToolMessages([message])[0]),
    strategy: async (messages, context) => {
      const compacted = await strategy(messages, context);
      // Checkpoints are provider views. Keep binary tool output in the transcript,
      // outside middleware state, so persisted checkpoints cannot duplicate its bytes.
      return compacted ? describeToolMessages(compacted) : null;
    },
  });
  return metadata
    ? {
        ...compaction,
        provides: [MetadataCapability],
        setup: (ctx) => provideMetadata(ctx, metadata),
      }
    : compaction;
}

/** withSkills deduplicates activation within a run, so cleared instructions must remain available. */
export function preserveSkillContext(): ChatMiddleware {
  return {
    name: "wingman-skill-context",
    onConfig(ctx, config) {
      if (ctx.phase !== "beforeModel" || !config.providerMessages) return;
      const canonical = describeToolMessages([...ctx.messages]);
      const retained = new Set(
        describeToolMessages(config.providerMessages)
          .filter((message) => message.role === "tool")
          .map((message) => message.content),
      );
      const missing = new Set(
        canonical
          .filter((message) => message.role === "tool" && !retained.has(message.content))
          .flatMap((message) => (message.toolCallId ? [message.toolCallId] : [])),
      );
      const skills = preservedSkillMessages(canonical, missing);
      if (!skills.length) return;
      return { providerMessages: [...skills, ...config.providerMessages] };
    },
  };
}
