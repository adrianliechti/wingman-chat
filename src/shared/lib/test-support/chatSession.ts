import { ChatClient, type ChatPersistedState, type ChatInterrupt } from "@tanstack/ai-client";
import { RunSidecar, approvalTools, streamRun, type AgentRunResult, type StreamRunHooks } from "../agent";
import type { Client } from "../client";
import type { Tool } from "../../types/chat";

export function chatSession(
  client: Client,
  tools: Tool[],
  store: { value?: ChatPersistedState } = {},
  hooks: Partial<StreamRunHooks> = {},
) {
  const sidecar = new RunSidecar();
  const finished: AgentRunResult[] = [];
  const ai: ChatClient = new ChatClient({
    threadId: "test-chat",
    tools: approvalTools(tools),
    persistence: {
      getItem: () => store.value ?? null,
      setItem: (_key, state) => {
        // Exercise the application's persistence boundary: the native record with rich outputs attached.
        store.value = JSON.parse(JSON.stringify({ ...state, messages: sidecar.apply(state.messages) }));
      },
      removeItem: () => {
        store.value = undefined;
      },
    },
    connection: {
      connect: (_messages, _data, signal, context) =>
        streamRun(client, "model", "", sidecar.apply(ai.getMessages()), tools, {
          ...hooks,
          sidecar,
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
  return { ai, finished, sidecar, store };
}

export function boundInterrupt(interrupt: ChatInterrupt) {
  if (interrupt.kind === "unbound") throw new Error("Expected a bound interrupt");
  return interrupt;
}
