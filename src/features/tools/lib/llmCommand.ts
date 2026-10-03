import { getConfig } from "@/shared/config";
import { runMessages } from "@/shared/lib/agent";
import type { ContentPart } from "@tanstack/ai";
import { finalText, userMessage } from "@/shared/lib/messages";
import type { LlmCallOptions } from "./interpreterProtocol";
import type { BridgeRequestOptions } from "./workerHost";

// Default model for `llm` calls — kept in sync with the chat's selected model
// by ChatProvider. Per-call options override it.
let defaultModel: string | null = null;

export function setModel(newModel: string | null): void {
  defaultModel = newModel;
}

export function getModel(): string | null {
  return defaultModel;
}

/** A fresh request: no chat history, previous helper output, or parent tools. */
export async function completeIsolated(
  model: string,
  content: ContentPart[],
  options: Pick<LlmCallOptions, "system" | "effort">,
  requestOptions: BridgeRequestOptions,
): Promise<string> {
  const messages = await runMessages(getConfig().client, model, options.system ?? "", [userMessage(content)], [], {
    context: requestOptions.context?.invocationContext,
    parentContext: requestOptions.context?.agentContext,
    options: { effort: options.effort, signal: requestOptions.signal },
  });
  const last = messages.at(-1);
  return last ? finalText(last) : "";
}

export async function runLlm(
  prompt: string,
  options: LlmCallOptions = {},
  requestOptions: BridgeRequestOptions = {},
): Promise<string> {
  const model = options.model || requestOptions.context?.model || defaultModel;
  if (!model) {
    throw new Error("llm: no model");
  }

  return completeIsolated(model, [{ type: "text", content: prompt }], options, requestOptions);
}
