import { ChatClient, type ChatPersistedState, type ChatInterrupt } from "@tanstack/ai-client";
import { AgentMessageMetadata, approvalTools, streamRun, type AgentRunResult, type StreamRunHooks } from "../agent";
import { toAIMessages } from "../aiMessages";
import type { Client } from "../client";
import type { Tool } from "../../types/chat";

export function chatSession(
  client: Client,
  tools: Tool[],
  store: { value?: ChatPersistedState } = {},
  hooks: Partial<StreamRunHooks> = {},
) {
  const metadata = new AgentMessageMetadata();
  const finished: AgentRunResult[] = [];
  const ai: ChatClient = new ChatClient({
    threadId: "test-chat",
    tools: approvalTools(tools),
    persistence: {
      getItem: () => store.value ?? null,
      setItem: (_key, state) => {
        // Exercise the application's existing domain storage boundary too.
        store.value = JSON.parse(
          JSON.stringify({
            ...state,
            messages: toAIMessages(metadata.read(state.messages), undefined, { state: metadata.state }),
          }),
        );
      },
      removeItem: () => {
        store.value = undefined;
      },
    },
    connection: {
      connect: (_messages, _data, signal, context) =>
        streamRun(client, "model", "", metadata.read(ai.getMessages()), tools, {
          ...hooks,
          metadata,
          options: { signal },
          threadId: context?.threadId,
          runId: context?.runId,
          parentRunId: context?.parentRunId,
          resume: context?.resume,
          onComplete: (result) => {
            finished.push(result);
          },
        }),
    },
  });
  return { ai, finished, metadata, store };
}

export function boundInterrupt(interrupt: ChatInterrupt) {
  if (interrupt.kind === "unbound") throw new Error("Expected a bound interrupt");
  return interrupt;
}
