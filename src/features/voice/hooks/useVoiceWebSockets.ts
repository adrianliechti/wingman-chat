import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { RealtimeClient } from "@tanstack/ai-client";
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { gatewayRealtime } from "@/features/voice/lib/gatewayRealtime";
import { serializeToolResultForApi } from "@/shared/lib/utils";
import type {
  AudioContent,
  FileContent,
  ImageContent,
  Message,
  TextContent,
  Tool,
  ToolContext,
} from "@/shared/types/chat";

export type ToolContextFactory = (toolCall: { id: string; name: string }) => ToolContext;
type ToolOutput = (TextContent | ImageContent | AudioContent | FileContent)[];

export function voiceSessionSignature(instructions: string, tools: Tool[], model?: string): string {
  return JSON.stringify([
    model,
    instructions,
    tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
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
  outputs: Map<string, ToolOutput>;
};

/** React/storage boundary for the native TanStack realtime client. */
export function useVoiceWebSockets(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void,
  onToolCall?: (toolName: string, callId: string) => void,
  onToolCallDone?: (callId: string) => void,
  onToolResult?: (toolName: string, callId: string, result: ToolOutput) => void,
  onClosed?: (reason?: { fatal: boolean; message: string }) => void,
  getRuntimeContext?: () => string,
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
  });
  useLayoutEffect(() => {
    callbacks.current = { onUser, onAssistant, onToolCall, onToolCallDone, onToolResult, onClosed, getRuntimeContext };
  });

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    session.controller.abort();
    await Promise.allSettled([...session.clients].map((client) => client.disconnect()));
    await session.gateway.disconnect();
  }, []);

  const bindClient = useCallback(
    (session: Session, capture: boolean, outputs: Map<string, ToolOutput>, onReady?: () => void) => {
      const { tools, instructions, factory } = session;
      const signal = session.controller.signal;
      const nativeTools = tools.map((tool) => {
        const schema = z.fromJSONSchema(tool.parameters);
        return toolDefinition({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: schema,
        }).client(async (input) => {
          signal.throwIfAborted();
          const identity = session.gateway.toolIdentity(input);
          if (!identity) throw new Error("Voice tool arguments must be an object");
          // RealtimeClient currently forwards parsed inputs without Standard Schema
          // validation; enforce the same schema used by the chat engine.
          const args = schema.parse(input) as Record<string, unknown>;
          const result = await tool.function(args, { ...factory?.(identity), runId: identity.runId, signal });
          signal.throwIfAborted();
          outputs.set(identity.id, result);
          return serializeToolResultForApi(result);
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
    },
    [],
  );

  const start = useCallback(
    async (
      realtimeModel = "gpt-realtime-2.1",
      transcribeModel = "gpt-live-transcribe",
      instructions?: string,
      messages: Message[] = [],
      tools: Tool[] = [],
      inputDeviceId?: string,
      outputDeviceId?: string,
      onAudioLevel?: (level: number) => void,
      toolContextFactory?: ToolContextFactory,
      onReady?: () => void,
    ) => {
      if (sessionRef.current) return;
      const controller = new AbortController();
      const outputs = new Map<string, ToolOutput>();
      const gateway = gatewayRealtime({
        model: realtimeModel,
        transcriber: transcribeModel,
        config: {
          instructions,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: tool.parameters,
          })),
        },
        history: messages,
        signal: controller.signal,
        inputDeviceId,
        outputDeviceId,
        onAudioLevel,
        runtimeContext: () => callbacks.current.getRuntimeContext?.(),
        onToolCall: ({ name, id }) => callbacks.current.onToolCall?.(name, id),
        onToolOutput: ({ name, id }, output) => {
          callbacks.current.onToolResult?.(name, id, outputs.get(id) ?? [{ type: "text", text: output }]);
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
        session.binding = bindClient(session, true, outputs, onReady).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          void stop();
          callbacks.current.onClosed?.({
            fatal: true,
            message: error instanceof Error ? error.message : "Couldn't start voice mode",
          });
        });
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
          if (!session.controller.signal.aborted) await bindClient(session, false, session.outputs);
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
