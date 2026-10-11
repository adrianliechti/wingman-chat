import type { ChatMiddleware, UIMessage } from "@tanstack/ai";
import { isUserPrompt, textParts } from "../messages";
import { extractUiFences, type UiBlock } from "./protocol.ts";
import { InlineUiRuntime, type UiSubmission } from "./runtime.ts";

/** The visible user turn stays human-readable; the model receives the exact protocol payload. */
export function submissionText(submission: UiSubmission): string {
  return "action" in submission.message
    ? (submission.message.action.userMessage ?? submission.message.action.name)
    : "Interface response";
}

export function uiDiagnostics(messages: UIMessage[]): ChatMiddleware {
  let emitted = false;
  return {
    name: "a2ui-context",
    onConfig: (ctx, config) => {
      if (ctx.phase !== "beforeModel" || emitted) return;
      emitted = true;
      const lastUser = messages.findLast(isUserPrompt);
      const submission = (lastUser?.metadata as { a2ui?: UiSubmission } | undefined)?.a2ui;
      const blocks: UiBlock[] = messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          textParts(message).flatMap((part, partIndex) =>
            extractUiFences(part.content).map((source, i) => ({ key: `${message.id}/${partIndex}/${i}`, source })),
          ),
        );
      const runtime = new InlineUiRuntime();
      let errors: string[];
      try {
        runtime.sync(blocks);
        errors = [...runtime.errors].map(([key, error]) => `${key}: ${error}`);
      } finally {
        runtime.dispose();
      }
      const notes = [
        ...(submission
          ? [
              `The user interacted with an inline interface. A2UI action and renderer metadata:\n${JSON.stringify(submission)}`,
            ]
          : []),
        ...(errors.length
          ? [
              `A2UI diagnostics: ${errors.slice(-5).join("; ").slice(0, 6000)}. If still needed, emit a corrected A2UI message using the documented catalogs.`,
            ]
          : []),
      ];
      if (!notes.length) return;
      return {
        providerMessages: [
          ...(config.providerMessages ?? config.messages),
          { role: "user", content: notes.join("\n\n") },
        ],
      };
    },
  };
}
