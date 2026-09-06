import { getConfig } from "@/shared/config";
import { getTextFromContent, Role } from "@/shared/types/chat";
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

export function consumeLlmBudget(options: BridgeRequestOptions): void {
  options.signal?.throwIfAborted();
  const invocation = options.context?.invocationContext;
  if (invocation && !invocation.tryConsumeModelCall()) {
    throw Object.assign(new Error("The invocation-wide model-call budget was exhausted."), { code: "MAX_TURNS" });
  }
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

  consumeLlmBudget(requestOptions);
  const result = await getConfig().client.complete(
    model,
    options.system ?? "",
    [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
    [],
    undefined,
    {
      ...(options.effort ? { effort: options.effort } : {}),
      signal: requestOptions.signal,
      parentContext: requestOptions.context?.agentContext,
    },
  );
  return getTextFromContent(result.content);
}
