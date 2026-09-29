import { getConfig } from "@/shared/config";
import { runMessages } from "@/shared/lib/agent";
import { getFinalTextFromContent } from "@/shared/lib/assistantText";
import { Role, type ImageContent, type TextContent } from "@/shared/types/chat";
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
  content: Array<TextContent | ImageContent>,
  options: Pick<LlmCallOptions, "system" | "effort">,
  requestOptions: BridgeRequestOptions,
): Promise<string> {
  const messages = await runMessages(
    getConfig().client,
    model,
    options.system ?? "",
    [{ role: Role.User, content }],
    [],
    {
      invocationContext: requestOptions.context?.invocationContext,
      parentContext: requestOptions.context?.agentContext,
      options: { effort: options.effort, signal: requestOptions.signal },
    },
  );
  return getFinalTextFromContent(messages.at(-1)?.content ?? []);
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

  return completeIsolated(model, [{ type: "text", text: prompt }], options, requestOptions);
}
