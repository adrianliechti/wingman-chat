import instructions from "../prompts/summarize-history.txt?raw";
import { chat, MetadataCapability, provideMetadata, type MetadataStore, type ChatMiddleware } from "@tanstack/ai";
import { clearToolResults, composeStrategies, summarizeOldest, withCompaction } from "@tanstack/ai-compaction";
import { followAbortSignal } from "@/shared/lib/abortSignals";
import type { Client } from "@/shared/lib/client";
import { aiTelemetry } from "@/shared/lib/otel";
import { preservedSkillMessages } from "./chatHistory";

/** Native provider-context compaction; saved messages and tool results stay complete. */
export function chatCompaction(
  client: Client,
  maxTokens: number,
  model: string,
  signal?: AbortSignal,
  metadata?: MetadataStore,
): ChatMiddleware {
  const compaction = withCompaction({
    maxTokens,
    strategyKey: `wingman-summary-v2:${model}:${instructions}`,
    strategy: composeStrategies(
      clearToolResults(),
      summarizeOldest({
        summarize: async (messages) => {
          const { controller: abortController, cleanup } = followAbortSignal(signal);
          try {
            return await chat({
              adapter: client.textAdapter(model, signal),
              // A compacted prefix often ends with an assistant/tool turn.
              // Request a new summary instead of an assistant prefill, which
              // several gateway providers reject.
              messages: [...messages, { role: "user", content: "Summarize the preceding conversation." }],
              systemPrompts: [instructions],
              middleware: [aiTelemetry("summarize_history")],
              stream: false,
              abortController,
            });
          } finally {
            cleanup();
          }
        },
      }),
    ),
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
      const retained = new Set(
        config.providerMessages.filter((message) => message.role === "tool").map((message) => message.content),
      );
      const missing = new Set(
        ctx.messages
          .filter((message) => message.role === "tool" && !retained.has(message.content))
          .flatMap((message) => (message.toolCallId ? [message.toolCallId] : [])),
      );
      const skills = preservedSkillMessages(ctx.messages, missing);
      if (!skills.length) return;
      return { providerMessages: [...skills, ...config.providerMessages] };
    },
  };
}
