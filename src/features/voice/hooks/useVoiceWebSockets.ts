import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { RealtimeClient } from "@tanstack/ai-client";
import {
  convertSchemaToJsonSchema,
  parseWithStandardSchema,
  toolDefinition,
  type ToolResultPart,
  type UIMessage,
  type UIResourcePart,
} from "@tanstack/ai";
import { gatewayRealtime } from "@/features/voice/lib/gatewayRealtime";
import { assistantMessage, describeToolOutput, text, toolResultContent } from "@/shared/lib/messages";
import type { MessageError, Tool, ToolContext } from "@/shared/types/chat";

export type ToolContextFactory = (toolCall: { id: string; name: string }) => ToolContext;

export function voiceSessionSignature(instructions: string, tools: Tool[], model?: string): string {
  return JSON.stringify([
    model,
    instructions,
    tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema: convertSchemaToJsonSchema(inputSchema),
    })),
  ]);
}

type Session = {
  controller: AbortController;
  gateway: ReturnType<typeof gatewayRealtime>;
  clients: Set<RealtimeClient>;
  client?: RealtimeClient;
  tools: Tool[];
  instructions?: string;
  factory?: ToolContextFactory;
  binding: Promise<void>;
  outputs: Map<string, { result: ToolResultPart; uiResources: UIResourcePart[] }>;
};

/** React/storage boundary for the native TanStack realtime client. */
export function useVoiceWebSockets(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void,
  onToolCall?: (toolName: string, callId: string) => void,
  onToolCallDone?: (callId: string) => void,
  onToolResult?: (message: UIMessage) => void,
  onClosed?: (reason?: { fatal: boolean; message: string }) => void,
  getRuntimeContext?: () => string,
  onError?: (error: Error) => void,
) {
  const sessionRef = useRef<Session | null>(null);
  const callbacks = useRef({
    onUser,
    onAssistant,
    onToolCall,
    onToolCallDone,
    onToolResult,
    onClosed,
    getRuntimeContext,
    onError,
  });
  useLayoutEffect(() => {
    callbacks.current = {
      onUser,
      onAssistant,
      onToolCall,
      onToolCallDone,
      onToolResult,
      onClosed,
      getRuntimeContext,
      onError,
    };
  });

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    session.controller.abort();
    await Promise.allSettled([...session.clients].map((client) => client.disconnect()));
    await session.gateway.disconnect();
  }, []);

  const bindClient = useCallback((session: Session, capture: boolean, onReady?: () => void) => {
    const { tools, instructions, factory, outputs } = session;
    const signal = session.controller.signal;
    const nativeTools = tools.map((tool) => {
      return toolDefinition({ ...tool, outputSchema: undefined }).client(async (input) => {
        signal.throwIfAborted();
        const identity = session.gateway.toolIdentity(input);
        if (!identity) throw new Error("Voice tool arguments must be an object");
        const uiResources: UIResourcePart[] = [];
        let meta: Record<string, unknown> = {};
        let error: MessageError | undefined;
        try {
          // RealtimeClient currently skips Standard Schema validation.
          const args = parseWithStandardSchema<Record<string, unknown>>(tool.inputSchema, input);
          const content = await tool.execute(args, {
            toolCallId: identity.id,
            abortSignal: signal,
            context: {
              ...factory?.(identity),
              runId: identity.runId,
              signal,
              setMeta: (next) => {
                if (!signal.aborted) meta = { ...meta, ...next };
              },
              setError: (next) => {
                if (!signal.aborted) error = next;
              },
            },
            emitCustomEvent(name, value) {
              if (!signal.aborted && name === "ui-resource" && value && typeof value === "object") {
                uiResources.push({
                  ...(value as Omit<UIResourcePart, "type">),
                  type: "ui-resource",
                  toolCallId: identity.id,
                });
              }
            },
          });
          signal.throwIfAborted();
          outputs.set(identity.id, {
            result: {
              type: "tool-result",
              toolCallId: identity.id,
              content,
              state: error ? "error" : "complete",
              ...(error ? { error: error.message } : {}),
              ...(Object.keys(meta).length ? { metadata: { meta } } : {}),
            },
            uiResources,
          });
          if (error) throw new Error(error.message);
          return describeToolOutput(content);
        } catch (error) {
          if (!signal.aborted && !outputs.has(identity.id)) {
            const message = error instanceof Error ? error.message : String(error);
            outputs.set(identity.id, {
              result: {
                type: "tool-result",
                toolCallId: identity.id,
                content: [text(message)],
                state: "error",
                error: message,
                ...(Object.keys(meta).length ? { metadata: { meta } } : {}),
              },
              uiResources,
            });
          }
          throw error;
        }
      });
    });
    const client = new RealtimeClient({
      adapter: session.gateway.adapter(),
      // The same-origin Go gateway authenticates this connection. No provider
      // credential or ephemeral-token service is needed in the browser.
      getToken: async () => ({ provider: "wingman", token: "", expiresAt: Date.now() + 86_400_000, config: {} }),
      tools: nativeTools,
      instructions,
      vadMode: "semantic",
      autoCapture: capture,
      onConnect: () => {
        if (!signal.aborted && capture) onReady?.();
      },
      onError: (error) => {
        // connect() marks failures before rejecting; the binding's catch reports
        // those through onClosed. Gateway failures close after emitting an error.
        queueMicrotask(() => {
          if (sessionRef.current !== session || signal.aborted || client.status === "error") return;
          console.warn("[voice] realtime error:", error);
          callbacks.current.onError?.(error);
        });
      },
      onMessage: (message) => {
        if (signal.aborted) return;
        const text = message.parts
          .map((part) => (part.type === "audio" ? part.transcript : part.type === "text" ? part.content : ""))
          .join("");
        // sendText is already persisted by chat before it reaches voice.
        if (message.role === "user" && message.parts.some((part) => part.type === "audio"))
          callbacks.current.onUser(text);
        else if (message.role === "assistant" && text) callbacks.current.onAssistant(text);
      },
    });
    session.clients.add(client);
    session.client = client;
    return client.connect().then(async () => {
      if (signal.aborted) await client.disconnect();
    });
  }, []);

  const start = useCallback(
    async (
      realtimeModel = "gpt-realtime-2.1",
      transcribeModel = "gpt-live-transcribe",
      instructions?: string,
      messages: UIMessage[] = [],
      tools: Tool[] = [],
      inputDeviceId?: string,
      outputDeviceId?: string,
      onAudioLevel?: (level: number) => void,
      toolContextFactory?: ToolContextFactory,
      onReady?: () => void,
    ) => {
      if (sessionRef.current) return;
      const controller = new AbortController();
      const outputs: Session["outputs"] = new Map();
      // Instructions and tools reach the session through RealtimeClient's own
      // configuration; the gateway only supplies transport and audio settings.
      const gateway = gatewayRealtime({
        model: realtimeModel,
        transcriber: transcribeModel,
        history: messages,
        signal: controller.signal,
        inputDeviceId,
        outputDeviceId,
        onAudioLevel,
        runtimeContext: () => callbacks.current.getRuntimeContext?.(),
        onToolCall: ({ name, id }) => callbacks.current.onToolCall?.(name, id),
        onToolOutput: ({ name, id, arguments: args }, output) => {
          if (controller.signal.aborted) return;
          const saved = outputs.get(id);
          const result: ToolResultPart = saved?.result ?? {
            type: "tool-result",
            toolCallId: id,
            content: [text(output)],
            state: "complete",
          };
          callbacks.current.onToolResult?.(
            assistantMessage([
              { type: "tool-call", id, name, arguments: args, state: "complete", output: toolResultContent(result) },
              result,
              ...(saved?.uiResources ?? []),
            ]),
          );
          outputs.delete(id);
          callbacks.current.onToolCallDone?.(id);
        },
        onClosed: (error) => {
          if (sessionRef.current?.controller !== controller) return;
          void stop();
          callbacks.current.onClosed?.(error ? { fatal: true, message: error.message } : undefined);
        },
      });
      const session: Session = {
        controller,
        gateway,
        clients: new Set(),
        tools,
        instructions,
        factory: toolContextFactory,
        binding: Promise.resolve(),
        outputs,
      };
      sessionRef.current = session;
      try {
        await gateway.prepare();
        if (controller.signal.aborted) return;
        session.binding = bindClient(session, true, onReady).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          void stop();
          callbacks.current.onClosed?.({
            fatal: true,
            message: error instanceof Error ? error.message : "Couldn't start voice mode",
          });
        });
        // The client configures the session before the socket opens, so the
        // first session.update already carries instructions and tools.
        await Promise.race([gateway.configured, session.binding]);
      } catch (error) {
        if (controller.signal.aborted) return;
        await stop();
        throw error;
      }
    },
    [stop, bindClient],
  );

  const updateSession = useCallback(
    (tools?: Tool[], instructions?: string, factory?: ToolContextFactory) => {
      const session = sessionRef.current;
      if (!session) return;
      if (tools !== undefined) session.tools = tools;
      if (instructions !== undefined) session.instructions = instructions;
      if (factory !== undefined) session.factory = factory;
      session.binding = session.binding
        .then(async () => {
          if (!session.controller.signal.aborted) await bindClient(session, false);
        })
        .catch((error: unknown) => {
          if (!session.controller.signal.aborted) {
            void stop();
            callbacks.current.onClosed?.({
              fatal: true,
              message: error instanceof Error ? error.message : "Couldn't update voice tools",
            });
          }
        });
    },
    [bindClient, stop],
  );

  const sendText = useCallback((text: string): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return Promise.resolve();
    const send = () => {
      if (session !== sessionRef.current) return Promise.resolve();
      session.client?.sendText(text);
      return session.gateway.textSettled();
    };
    return session.client?.status === "connected" ? send() : session.binding.then(send);
  }, []);
  const pauseAudio = useCallback(
    async (flush = true) => sessionRef.current?.gateway.pauseAudio(flush) ?? (async () => {}),
    [],
  );
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );
  return { start, stop, sendText, updateSession, pauseAudio };
}
