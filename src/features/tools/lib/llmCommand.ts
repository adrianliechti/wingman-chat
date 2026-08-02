import { getConfig } from "@/shared/config";
import { getTextFromContent, Role } from "@/shared/types/chat";
import type { LlmCallOptions } from "./interpreterProtocol";

// Default model for `llm` calls — kept in sync with the chat's selected model
// by ChatProvider. Per-call options override it.
let defaultModel: string | null = null;

export function setModel(newModel: string | null): void {
  defaultModel = newModel;
}

export function getModel(): string | null {
  return defaultModel;
}

export async function runLlm(
  prompt: string,
  options: LlmCallOptions = {},
  requestOptions: { signal?: AbortSignal } = {},
): Promise<string> {
  const model = options.model || defaultModel;
  if (!model) {
    throw new Error("llm: no model");
  }

  const result = await getConfig().client.complete(
    model,
    options.system ?? "",
    [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
    [],
    undefined,
    { ...(options.effort ? { effort: options.effort } : {}), signal: requestOptions.signal },
  );
  return getTextFromContent(result.content);
}
