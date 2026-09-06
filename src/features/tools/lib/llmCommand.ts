import { getConfig } from "@/shared/config";
import { combineAbortSignals } from "@/shared/lib/abortSignals";
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
  const invocation = requestOptions.context?.invocationContext;
  const combined = combineAbortSignals(requestOptions.signal, invocation?.signal);
  try {
    combined.signal?.throwIfAborted();
    if (invocation && !invocation.tryConsumeModelCall()) {
      throw Object.assign(new Error("The invocation-wide model-call budget was exhausted."), { code: "MAX_TURNS" });
    }
    const result = await getConfig().client.complete(
      model,
      options.system ?? "",
      [{ role: Role.User, content }],
      [],
      undefined,
      {
        ...(options.effort ? { effort: options.effort } : {}),
        signal: combined.signal,
        parentContext: requestOptions.context?.agentContext,
      },
    );
    combined.signal?.throwIfAborted();
    return getFinalTextFromContent(result.content);
  } finally {
    combined.cleanup();
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

  return completeIsolated(model, [{ type: "text", text: prompt }], options, requestOptions);
}
