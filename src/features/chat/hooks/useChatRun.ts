import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  ChatClient,
  type ChatInterruptState,
  type QueuedMessage,
  type RunAgentInputContext,
} from "@tanstack/ai-client";
import type { ContentPart, StreamChunk } from "@tanstack/ai";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { applyArtifactStopPolicy } from "@/features/artifacts/lib/artifact-stop-policy";
import { type FileSystemManager, resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { parseArtifactReference } from "../components/chatMessageUtils";
import type { ChatContextType } from "../context/ChatContext";
import type { useChatContext } from "./useChatContext";
import { historyForRetry, prepareChatMessages } from "../lib/chatHistory";
import { chatCompaction, preserveSkillContext } from "../lib/chatCompaction";
import { getConfig } from "@/shared/config";
import { AgentMessageMetadata, approvalTools, streamRun } from "@/shared/lib/agent";
import { toAIMessages } from "@/shared/lib/aiMessages";
import { getErrorInfo, isAbortError } from "@/shared/lib/errors";
import { compactThreshold } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { captureRequestContext, isUserMessage } from "@/shared/lib/requestContext";
import type { Chat, Content, Message, Model } from "@/shared/types/chat";
import { Role, updateToolResultMeta, withMessageIdentity } from "@/shared/types/chat";
import { useChatClassification } from "./useChatClassification";
import { useChatElicitation } from "./useChatElicitation";
import { createAttachmentLoader } from "../lib/chatAttachments";
import { beginMemoryRun, enqueueMemoryLearning } from "@/features/agent/lib/memoryLearning";
import { recallMemory } from "@/features/agent/lib/memoryRecall";
import { memoryMessageText, reconcileMemorySources } from "@/features/agent/lib/memorySources";

interface Session {
  id: string;
  ai: ChatClient;
  metadata: AgentMessageMetadata;
}

function userContent(message: Message) {
  const native = toAIMessages([message])[0];
  return { id: native.id, content: native.parts as ContentPart[], metadata: native.metadata };
}

interface Options {
  model: Model | null;
  models: Model[];
  chatId: string | null;
  chatLoaded: boolean;
  chatIdRef: RefObject<string | null>;
  fsRef: RefObject<FileSystemManager | null>;
  artifactsEnabled: boolean;
  getChat: (id: string) => Chat | undefined;
  updateChat: ChatContextType["updateChat"];
  getOrCreateChat: () => Promise<{ id: string; chat: Chat; fs: FileSystemManager }>;
  chatTools: ReturnType<typeof useChatContext>["tools"];
  chatInstructions: ReturnType<typeof useChatContext>["instructions"];
  chatMiddleware: ReturnType<typeof useChatContext>["middleware"];
  chatRuntimeContext: ReturnType<typeof useChatContext>["runtimeContext"];
  chatMemory: ReturnType<typeof useChatContext>["memory"];
}

export function useChatRun({
  model,
  models,
  chatId,
  chatLoaded,
  chatIdRef,
  fsRef,
  artifactsEnabled,
  getChat,
  updateChat,
  getOrCreateChat,
  chatTools,
  chatInstructions,
  chatMiddleware,
  chatRuntimeContext,
  chatMemory,
}: Options) {
  const config = getConfig();
  const client = config.client;
  const sessionRef = useRef<Session | null>(null);
  const pendingModelContextRef = useRef(new Map<string, string>());
  // Realtime and legacy MCP URL requests have a live transport callback.
  // Chat forms and tool approvals use ChatClient's durable interrupts below.
  const { pendingElicitation, requestElicitation, resolveElicitation, completeElicitation, clearElicitation } =
    useChatElicitation();
  const { classify, pendingConsent, resolveConsent } = useChatClassification({ models, chatId, chatIdRef, updateChat });
  const [isResponding, setIsResponding] = useState(false);
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [queuedSends, setQueuedSends] = useState<QueuedMessage[]>([]);
  const [interruptState, setInterruptState] = useState<ChatInterruptState | null>(null);
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const updateToolMeta = useCallback((id: string, meta: Record<string, unknown>) => {
    setToolMeta((prev) => ({ ...prev, [id]: { ...prev[id], ...meta } }));
  }, []);
  const updateModelContext = useCallback(async (id: string, text: string | null) => {
    if (text?.trim()) pendingModelContextRef.current.set(id, text.trim());
    else pendingModelContextRef.current.delete(id);
  }, []);

  const connect = useCallback(
    async function* (
      session: Session,
      signal?: AbortSignal,
      runContext?: RunAgentInputContext,
    ): AsyncGenerator<StreamChunk> {
      if (!model) throw new Error("No model selected");
      const { id, ai, metadata } = session;
      const runId = runContext?.runId ?? crypto.randomUUID();
      const read = () => metadata.read(ai.getMessages(), model.id);
      const conversation = read();
      const outgoing = conversation.findLast(isUserMessage);
      const loadAttachments = createAttachmentLoader(id);
      const memory = chatMemory();
      const releaseMemory = memory ? beginMemoryRun(memory) : undefined;
      const active = () => sessionRef.current === session && !signal?.aborted;
      const runFs = artifactsEnabled ? resolveArtifactFileSystem(fsRef.current, id) : null;
      const startLength = conversation.length;
      try {
        const tools = await chatTools();
        ai.updateOptions({ tools: approvalTools(tools) });
        signal?.throwIfAborted();
        const toolMessage = outgoing ? (await loadAttachments([outgoing], signal))[0] : undefined;
        let memoryContext = "";
        if (memory) {
          try {
            await reconcileMemorySources(memory);
            memoryContext = recallMemory(await memory.snapshot(), outgoing ? memoryMessageText(outgoing) : "");
          } catch (error) {
            console.warn("Memory recall unavailable:", error);
          }
        }
        signal?.throwIfAborted();
        const requestContext = captureRequestContext(
          [chatRuntimeContext(), memoryContext].filter(Boolean).join("\n\n"),
        );
        if (!runContext?.resume?.length)
          classify({
            id,
            runId,
            conversation,
            title: getChat(id)?.title,
            hasMessage: true,
            currentModel: model,
            signal,
          });
        const compaction = config.chat?.compaction;
        let threshold = compaction ? (model.compactThreshold ?? compactThreshold(model.id)) : 0;
        if (compaction?.threshold !== undefined && threshold > 0) threshold = Math.min(threshold, compaction.threshold);
        yield* streamRun(client, model.id, chatInstructions(), conversation, tools, {
          runId,
          threadId: id,
          parentRunId: runContext?.parentRunId,
          resume: runContext?.resume,
          agentName: "chat",
          metadata,
          middleware: chatMiddleware(),
          sharedMiddleware: (runSignal) =>
            threshold > 0
              ? [
                  chatCompaction(client, threshold, config.chat?.summarizer || model.id, runSignal),
                  preserveSkillContext(),
                ]
              : [],
          options: { effort: model.effort, summary: model.summary, verbosity: model.verbosity, signal },
          prepareMessages: (messages) => loadAttachments(prepareChatMessages(messages, requestContext), signal),
          onEvent: (event) => {
            if (!active()) return;
            if (
              event.type === "model.started" ||
              event.type === "tool.completed" ||
              event.type === "verification.completed"
            )
              setRunPhase("thinking");
            else if (event.type === "model.streaming") setRunPhase("responding");
            else if (event.type === "tool.started" || event.type === "verification.started")
              setRunPhase("running_tool");
          },
          createToolContext: (call) => ({
            model: model.id,
            chatId: id,
            signal,
            content: () =>
              (toolMessage?.content ?? []).filter((p) => p.type === "text" || p.type === "image" || p.type === "file"),
            sendMessage: async (message) => {
              if (sessionRef.current === session) await ai.sendMessage(userContent(message));
            },
            setContext: (text) => updateModelContext(id, text),
            elicit: (elicitation) => requestElicitation(call.id, call.name, elicitation, signal),
            onElicitationComplete: (elicitationId) => {
              if (active()) completeElicitation(elicitationId);
            },
          }),
          onToolResult: (result) => {
            if (!active()) return;
            clearElicitation();
            setToolMeta((prev) => {
              const next = { ...prev };
              for (const part of result.content) if (part.type === "tool_result") delete next[part.id];
              return next;
            });
          },
          beforeFinish: ({ runId: activeRunId, messages, signal: runSignal }) =>
            runFs
              ? applyArtifactStopPolicy({ chatId: id, runId: activeRunId, messages, fs: runFs, signal: runSignal })
              : Promise.resolve({ action: "finish" }),
          onToolMeta: (callId, meta) => {
            if (signal?.aborted) return;
            if (active()) updateToolMeta(callId, meta);
            updateChat(id, (prev) => ({ messages: updateToolResultMeta(prev.messages, callId, meta) }));
          },
          onComplete: async (result) => {
            if (!memory || result.status !== "completed" || !active()) return;
            const delta = result.messages.slice(startLength);
            if (outgoing) delta.unshift(outgoing);
            await enqueueMemoryLearning(memory, id, config.chat?.summarizer || model.id, delta).catch((error) =>
              console.warn("Memory learning could not be queued:", error),
            );
          },
        });
      } finally {
        releaseMemory?.();
      }
    },
    [
      model,
      chatMemory,
      artifactsEnabled,
      fsRef,
      chatTools,
      chatRuntimeContext,
      classify,
      getChat,
      config.chat?.compaction,
      config.chat?.summarizer,
      client,
      chatInstructions,
      chatMiddleware,
      updateModelContext,
      requestElicitation,
      completeElicitation,
      clearElicitation,
      updateToolMeta,
      updateChat,
    ],
  );
  const toolsRef = useRef(chatTools);
  useLayoutEffect(() => {
    toolsRef.current = chatTools;
  }, [chatTools]);
  const connectRef = useRef(connect);
  useLayoutEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const ensureClient = useCallback(
    (id: string): Session => {
      if (sessionRef.current?.id === id) return sessionRef.current;
      sessionRef.current?.ai.dispose();
      const metadata = new AgentMessageMetadata();
      const session = { id, metadata } as Session;
      const ai = new ChatClient({
        threadId: id,
        initialMessages: toAIMessages(getChat(id)?.messages ?? []),
        queue: { whenBusy: "queue", drain: "batch" },
        connection: { connect: (_messages, _data, signal, context) => connectRef.current(session, signal, context) },
        persistence: {
          getItem: async () => {
            const tools = await toolsRef.current();
            ai.updateOptions({ tools: approvalTools(tools) });
            const saved = getChat(id);
            return saved ? { messages: toAIMessages(saved.messages), resume: saved.aiResume } : null;
          },
          setItem: (_key, state) =>
            updateChat(
              id,
              () => ({
                messages: metadata.read(state.messages),
                // Execution lives in this tab. A paused interrupt can resume after
                // reload; an interrupted network stream cannot be replayed here.
                aiResume: state.resume?.pendingInterrupts?.length ? state.resume : undefined,
              }),
              { preserveDates: true },
            ),
          removeItem: () => updateChat(id, () => ({ messages: [], aiResume: undefined })),
        },
        onLoadingChange: (loading) => {
          if (loading) updateChat(id, () => ({}));
          setIsResponding(loading);
          if (!loading) setRunPhase("idle");
        },
        onStatusChange: (status) => {
          if (status === "submitted") setRunPhase("thinking");
        },
        onQueueChange: setQueuedSends,
        onInterruptStateChange: setInterruptState,
        onChunk: (chunk) => {
          if (chunk.type === "CUSTOM" && chunk.name === "compaction:started") setRunPhase("compacting");
          else if (chunk.type === "CUSTOM" && chunk.name === "compaction:ended") setRunPhase("thinking");
        },
        onError: (error) => {
          if (isAbortError(error)) return;
          const messages = metadata.read(ai.getMessages());
          const info = getErrorInfo(error);
          ai.setMessagesManually(
            toAIMessages([...messages, withMessageIdentity({ role: Role.Assistant, content: [], error: info })]),
          );
        },
      });
      session.ai = ai;
      sessionRef.current = session;
      setQueuedSends(ai.getQueue());
      setInterruptState(ai.getInterruptState());
      return session;
    },
    [getChat, updateChat],
  );

  useEffect(() => {
    if (sessionRef.current?.id !== chatId) {
      sessionRef.current?.ai.dispose();
      sessionRef.current = null;
      setQueuedSends([]);
      setInterruptState(null);
      setStreamingMessage(null);
      setToolMeta({});
      clearElicitation();
    }
    if (chatId && chatLoaded) ensureClient(chatId);
  }, [chatId, chatLoaded, ensureClient, clearElicitation]);
  useEffect(
    () => () => {
      sessionRef.current?.ai.dispose();
      sessionRef.current = null;
    },
    [],
  );

  const sendMessage = useCallback(
    async (message: Message, historyOverride?: Message[], artifactFiles?: ProcessedFile[], deletedPaths?: string[]) => {
      const { id, chat: chatObj, fs: chatFs } = await getOrCreateChat();
      if (!chatObj) {
        throw new Error(`Chat ${id} not found`);
      }
      // Deferred chat-input attachments: now that the chat (and its fs) exist,
      // write them into the workspace before the turn so the model can read
      // them via the artifacts tools (artifacts was enabled at attach time).
      let resolvedMessage = message;
      if (artifactFiles?.length) {
        try {
          const ingestion = await chatFs.ingestFiles(artifactFiles, {
            origin: { actor: "user", reason: "upload" },
          });
          const revisions = Object.fromEntries(
            ingestion.mutations.map((mutation) => [mutation.path, mutation.revision]),
          );
          resolvedMessage = promoteArtifactReferences(message, ingestion.pathMap, revisions);
        } catch (error) {
          console.error("Failed to add attachments transactionally:", error);
          notify.error("Attachments failed", "No files were added. Resolve the workspace conflict and try again.");
          throw error;
        }
      }

      // Delete requested artifact paths from chat FS (best-effort).
      if (deletedPaths && deletedPaths.length > 0) {
        try {
          await Promise.all(
            deletedPaths.map(async (p) => {
              try {
                await chatFs.deleteFileWithDelta(p, { origin: { actor: "user", reason: "delete" } });
              } catch (err) {
                console.error(`Failed to delete artifact ${p}:`, err);
                throw err;
              }
            }),
          );
        } catch (err) {
          console.error("One or more attachment deletions failed:", err);
          notify.error(
            "Failed to delete attachments",
            "One or more attachments couldn't be removed from the workspace.",
          );
        }
      }
      if (!getChat(id) || chatIdRef.current !== id) return;
      const session = ensureClient(id);
      if (historyOverride) session.ai.setMessagesManually(toAIMessages(historyOverride));
      const context = pendingModelContextRef.current.get(id) ?? null;
      pendingModelContextRef.current.delete(id);
      await session.ai.sendMessage(userContent(appendTextContent(withMessageIdentity(resolvedMessage), context)));
    },
    [getOrCreateChat, getChat, chatIdRef, ensureClient],
  );

  const retryMessage = useCallback(async () => {
    const chat = getChat(chatIdRef.current ?? "");
    if (!chat) return;
    const { ai } = ensureClient(chat.id);
    if (ai.getIsLoading()) return;
    const history = historyForRetry(chat.messages);
    if (!history) return;
    const native = toAIMessages(history);
    ai.setMessagesManually(native.slice(0, -1));
    await ai.append(native.at(-1)!);
  }, [getChat, chatIdRef, ensureClient]);

  const continueRun = useCallback(async () => {
    const chat = getChat(chatIdRef.current ?? "");
    if (!chat || chat.messages.at(-1)?.error?.code !== "MAX_TURNS") return;
    await sendMessage({ role: Role.User, content: [{ type: "text", text: "Continue." }] }, chat.messages.slice(0, -1));
  }, [getChat, chatIdRef, sendMessage]);

  const removeQueuedMessage = useCallback((id: string) => {
    sessionRef.current?.ai.cancelQueued(id);
  }, []);
  const stopStreaming = useCallback(() => {
    sessionRef.current?.ai.stop();
    clearElicitation();
    setStreamingMessage(null);
    setToolMeta({});
    setIsResponding(false);
    setRunPhase("idle");
  }, [clearElicitation]);
  const setVoiceToolCall = useCallback(
    (name: string | null, callId?: string) => {
      const id = chatIdRef.current;
      setIsResponding(!!name);
      setStreamingMessage(
        name && id
          ? {
              chatId: id,
              message: {
                role: Role.Assistant,
                content: [{ type: "tool_call", id: callId ?? crypto.randomUUID(), name, arguments: "{}" }],
              },
            }
          : null,
      );
    },
    [chatIdRef],
  );

  return {
    streamingMessage,
    isResponding,
    status: pendingElicitation || interruptState?.interrupts.length ? ("waiting" as const) : runPhase,
    queuedSends,
    interruptState,
    pendingElicitation,
    pendingConsent,
    toolMeta,
    sendMessage,
    retryMessage,
    continueRun,
    setVoiceToolCall,
    removeQueuedMessage,
    stopStreaming,
    resolveElicitation,
    requestElicitation,
    updateToolMeta,
    resolveConsent,
  };
}

function appendTextContent(message: Message, text: string | null): Message {
  if (!text || message.role !== Role.User) {
    return message;
  }

  return {
    ...message,
    content: [...message.content, { type: "text", text }],
  };
}

function promoteArtifactReferences(
  message: Message,
  pathMap: Record<string, string>,
  revisions: Record<string, string | undefined>,
): Message {
  return {
    ...message,
    content: message.content.flatMap((part): Content[] => {
      if (part.type === "artifact_ref") {
        const path = pathMap[part.path] ?? part.path;
        return [{ ...part, path, revision: revisions[path] ?? part.revision }];
      }
      if (part.type !== "text") return [part];
      const paths = parseArtifactReference(part.text);
      if (paths.length === 0) return [part];
      return paths.map((requested) => {
        const path = pathMap[requested] ?? requested;
        return {
          type: "artifact_ref" as const,
          path,
          revision: revisions[path],
          displayName: path.split("/").pop() ?? path,
        };
      });
    }),
  };
}
