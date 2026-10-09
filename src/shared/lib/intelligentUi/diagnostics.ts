/**
 * Diagnostics for ```ui fences the model produced, fed back on the next turn.
 *
 * A fence renders after the run has ended, so there is no later model call in
 * the same run to tell the model about a broken document. Instead, when the
 * user's next message starts a run, this middleware validates the fences of the
 * previous assistant turn and, if any failed, adds a short user-role note so
 * the model corrects its mistake instead of repeating it.
 */

import type { ChatMiddleware, UIMessage } from "@tanstack/ai";
import { isUserPrompt, textParts } from "../messages";
import { collectUnresolvedReferences, parseUiDocument, UI_FENCE_LANGUAGES, type UiNode } from "./schema";

const FENCE = /^([`~]{3,})[ \t]*([\w-]+)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

/** The bodies of every ```ui fence in a Markdown text. */
export function extractUiFences(markdown: string): string[] {
  const fences: string[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    if (UI_FENCE_LANGUAGES.has(match[2].toLowerCase())) fences.push(match[3].replace(/\n$/, ""));
  }
  return fences;
}

function nodeErrors(nodes: UiNode[], into: string[]): string[] {
  for (const node of nodes) {
    if (node.type === "error") {
      into.push(node.message);
      continue;
    }
    nodeErrors(node.children, into);
    if (node.tabs) for (const tab of node.tabs) nodeErrors(tab.children, into);
  }
  return into;
}

/** Human-readable problems in every ```ui fence of `markdown`; empty when all render. */
export function collectUiDiagnostics(markdown: string): string[] {
  const problems: string[] = [];
  extractUiFences(markdown).forEach((source, index) => {
    const label = `ui block ${index + 1}`;
    const parsed = parseUiDocument(source);
    if (parsed.status === "error") {
      problems.push(`${label}: not rendered, ${parsed.message}`);
      return;
    }
    if (parsed.status !== "ok") return;
    const errors = [...new Set(nodeErrors(parsed.document.children, []))];
    const unresolved = collectUnresolvedReferences(parsed.document);
    if (unresolved.length) {
      errors.push(`references undeclared state keys: ${unresolved.slice(0, 8).join(", ")}`);
    }
    if (errors.length) problems.push(`${label}: ${errors.slice(0, 5).join("; ")}`);
  });
  return problems;
}

/** The assistant text of the turn before the latest user prompt. */
function previousTurnText(messages: UIMessage[]): string {
  const last = messages.findLastIndex(isUserPrompt);
  if (last <= 0) return "";
  const previous = messages.slice(0, last).findLastIndex(isUserPrompt);
  return messages
    .slice(previous + 1, last)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => textParts(message).map((part) => part.content))
    .join("\n");
}

/** Feedback text for the previous turn's broken fences, or an empty string. */
export function uiFeedback(messages: UIMessage[]): string {
  const problems = collectUiDiagnostics(previousTurnText(messages));
  if (!problems.length) return "";
  return (
    "The interactive ```ui block in your previous reply had problems and was shown as an error or with missing parts. " +
    "If the user still needs it, emit a corrected block using only the documented components and strict JSON; " +
    "otherwise answer in text.\n" +
    problems.map((problem) => `- ${problem}`).join("\n")
  );
}

/** Adds the previous turn's ```ui diagnostics to the first model call of a run. */
export function uiDiagnostics(messages: UIMessage[]): ChatMiddleware {
  let feedback: string | null = null;
  return {
    name: "intelligent-ui-diagnostics",
    onConfig: (ctx, config) => {
      if (ctx.phase !== "beforeModel") return;
      feedback ??= uiFeedback(messages);
      if (!feedback) return;
      const note = feedback;
      // Only the first call of the run carries the note; later calls already have it in context.
      feedback = "";
      return {
        providerMessages: [...(config.providerMessages ?? config.messages), { role: "user", content: note }],
      };
    },
  };
}
