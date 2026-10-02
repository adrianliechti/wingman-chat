import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useChat as useNativeChat } from "@tanstack/ai-react";
import type { ChatInterruptState, RunAgentInputContext } from "@tanstack/ai-client";
import {
  normalizeToUIMessage,
  type ContentPart,
  type StreamChunk,
  type UIMessage,
  type ModelMessage,
} from "@tanstack/ai";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { artifactVerification } from "@/features/artifacts/lib/artifactVerification";
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
import { compactionStore, fromResume, toResume } from "../lib/chatRuntime";
import type { ChatStore } from "../lib/chatStore";
import { Role, updateToolResultMeta, withMessageIdentity } from "@/shared/types/chat";
import { useChatClassification } from "./useChatClassification";
import { useChatElicitation } from "./useChatElicitation";
import { createAttachmentLoader } from "../lib/chatAttachments";
import { beginMemoryRun, enqueueMemoryLearning } from "@/features/agent/lib/memoryLearning";
import { recallMemory } from "@/features/agent/lib/memoryRecall";
import { memoryMessageText, reconcileMemorySources } from "@/features/agent/lib/memorySources";

interface Session {
  id: string;
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
  threadId: string;
  chatIdRef: RefObject<string | null>;
  fsRef: RefObject<FileSystemManager | null>;
  artifactsEnabled: boolean;
  getChat: (id: string) => Chat | undefined;
  loadChat: (id: string) => Promise<Chat>;
  updateChat: ChatStore["updateChat"];
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
  threadId,
  chatIdRef,
  fsRef,
  artifactsEnabled,
  getChat,
  loadChat,
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
  const session = useMemo<Session>(() => ({ id: threadId, metadata: new AgentMessageMetadata() }), [threadId]);
  const storageOwnerRef = useRef<Session | null>(session);
  useLayoutEffect(() => {
    storageOwnerRef.current = session;
    return () => {
      storageOwnerRef.current = null;
    };
  }, [session]);
  const aiRef = useRef<ReturnType<typeof useNativeChat> | null>(null);
  const tools = useMemo(() => approvalTools(chatTools()), [chatTools]);
  // Realtime and legacy MCP URL requests have a live transport callback.
  // Chat forms and tool approvals use ChatClient's durable interrupts below.
  const { pendingElicitation, requestElicitation, resolveElicitation, completeElicitation, clearElicitation } =
    useChatElicitation();
  const { classify, pendingConsent, resolveConsent } = useChatClassification({ models, chatId, chatIdRef, updateChat });
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const updateToolMeta = useCallback((id: string, meta: Record<string, unknown>) => {
    setToolMeta((prev) => ({ ...prev, [id]: { ...prev[id], ...meta } }));
  }, []);

  const connect = useCallback(
    async function* (
      session: Session,
      nativeMessages: UIMessage[] | ModelMessage[],
      signal?: AbortSignal,
      runContext?: RunAgentInputContext,
    ): AsyncGenerator<StreamChunk> {
      if (!model) throw new Error("No model selected");
      const { id, metadata } = session;
      const runId = runContext?.runId ?? crypto.randomUUID();
      const conversation = metadata.read(
        nativeMessages.map((message) => normalizeToUIMessage(message, () => crypto.randomUUID())),
      );
      const outgoing = conversation.findLast(isUserMessage);
      const loadAttachments = createAttachmentLoader(id);
      const memory = chatMemory();
      const releaseMemory = memory ? beginMemoryRun(memory) : undefined;
      const active = () => chatIdRef.current === id && !signal?.aborted;
      const runFs = artifactsEnabled ? resolveArtifactFileSystem(fsRef.current, id) : null;
      const startLength = conversation.length;
      try {
        if (active()) setRunPhase("thinking");
        updateChat(id, () => ({}));
        const tools = chatTools();
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
          middleware: [
            ...chatMiddleware(),
            ...(runFs ? [artifactVerification(runFs, metadata, conversation)] : []),
            {
              onIteration: () => {
                if (active()) setRunPhase("thinking");
              },
              onBeforeToolCall: () => {
                if (active()) setRunPhase("running_tool");
              },
              onToolPhaseComplete: (_ctx, { results }) => {
                if (!active()) return;
                setRunPhase("thinking");
                if (!results.length) return;
                clearElicitation();
                setToolMeta((prev) => {
                  const next = { ...prev };
                  for (const { toolCallId } of results) delete next[toolCallId];
                  return next;
                });
              },
            },
          ],
          sharedMiddleware: (runSignal, context) =>
            threshold > 0
              ? [
                  chatCompaction(
                    client,
                    threshold,
                    config.chat?.summarizer || model.id,
                    runSignal,
                    compactionStore(
                      () => getChat(id)?.compactions,
                      (update) => {
                        if (runSignal.aborted) return;
                        updateChat(id, (prev) => ({ compactions: update(prev.compactions ?? []) }), {
                          preserveDates: true,
                        });
                      },
                      context.subagentRunId,
                    ),
                  ),
                  preserveSkillContext(),
                ]
              : [],
          options: { effort: model.effort, summary: model.summary, verbosity: model.verbosity, signal },
          prepareMessages: (messages) => loadAttachments(prepareChatMessages(messages, requestContext), signal),
          createToolContext: (call) => ({
            model: model.id,
            chatId: id,
            signal,
            content: () =>
              (toolMessage?.content ?? []).filter((p) => p.type === "text" || p.type === "image" || p.type === "file"),
            elicit: (elicitation) => requestElicitation(call.id, call.name, elicitation, signal),
            onElicitationComplete: (elicitationId) => {
              if (active()) completeElicitation(elicitationId);
            },
          }),
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
      chatIdRef,
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
      requestElicitation,
      completeElicitation,
      clearElicitation,
      updateToolMeta,
      updateChat,
    ],
  );
  const connectRef = useRef(connect);
  useLayoutEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const ai = useNativeChat({
    threadId: session.id,
    tools,
    queue: { whenBusy: "queue", drain: "batch" },
    connection: {
      connect: (messages, _data, signal, context) => connectRef.current(session, messages, signal, context),
    },
    persistence: {
      getItem: async () => {
        const saved = getChat(session.id) ?? (chatId === session.id ? await loadChat(session.id) : undefined);
        return saved
          ? {
              messages: toAIMessages(saved.messages),
              resume: toResume(saved.id, saved.pendingRun),
            }
          : null;
      },
      setItem: (_key, state) => {
        // A draft has no durable record until the first send or attachment.
        // useChat stops disposed clients; their cleanup must not erase a saved
        // approval or overwrite the conversation opened by their replacement.
        if (storageOwnerRef.current !== session || !getChat(session.id)) return;
        updateChat(
          session.id,
          () => ({
            messages: session.metadata.read(state.messages),
            pendingRun: fromResume(state.resume),
          }),
          { preserveDates: true },
        );
      },
      removeItem: () => {
        if (storageOwnerRef.current === session && getChat(session.id))
          updateChat(session.id, () => ({ messages: [], pendingRun: undefined, compactions: undefined }));
      },
    },
    onChunk: (chunk) => {
      if (chatIdRef.current !== session.id) return;
      if (chunk.type === "TEXT_MESSAGE_CONTENT") setRunPhase("responding");
      else if (chunk.type === "CUSTOM" && chunk.name === "compaction:started") setRunPhase("compacting");
      else if (chunk.type === "CUSTOM" && chunk.name === "compaction:ended") setRunPhase("thinking");
    },
    onError: (error) => {
      if (isAbortError(error) || chatIdRef.current !== session.id) return;
      const messages = getChat(session.id)?.messages ?? [];
      ai.setMessages(
        toAIMessages([
          ...messages,
          withMessageIdentity({ role: Role.Assistant, content: [], error: getErrorInfo(error) }),
        ]),
      );
    },
  });
  useLayoutEffect(() => {
    aiRef.current = ai;
  }, [ai]);
  useEffect(() => {
    setStreamingMessage(null);
    setToolMeta({});
    clearElicitation();
  }, [threadId, clearElicitation]);

  const interruptState = useMemo<ChatInterruptState>(
    () => ({
      interrupts: ai.interrupts,
      pendingInterrupts: ai.pendingInterrupts,
      interruptErrors: ai.interruptErrors,
      resuming: ai.resuming,
    }),
    [ai.interrupts, ai.pendingInterrupts, ai.interruptErrors, ai.resuming],
  );
  const { sendMessage: sendNativeMessage, setMessages, append, stop, isLoading } = ai;
  const isResponding = ai.isLoading || !!streamingMessage;
  const status: ChatContextType["status"] =
    pendingElicitation || ai.interrupts.length
      ? "waiting"
      : isResponding
        ? runPhase === "idle"
          ? "thinking"
          : runPhase
        : "idle";

  const addMessage = useCallback(
    async (message: Message, targetChatId?: string) => {
      const id = targetChatId ?? (await getOrCreateChat()).id;
      await loadChat(id);
      const chat = getChat(id);
      if (!chat) return;
      const messages = [...chat.messages, withMessageIdentity(message)];
      // Voice and externally produced messages enter the same live transcript.
      // A callback for an inactive conversation only updates its stored record.
      if (id === session.id && chatIdRef.current === id) {
        setMessages(toAIMessages(messages));
        updateChat(id, () => ({}));
      } else updateChat(id, () => ({ messages }));
    },
    [getOrCreateChat, loadChat, getChat, session.id, chatIdRef, setMessages, updateChat],
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
      if (session.id !== id) return;
      if (historyOverride) setMessages(toAIMessages(historyOverride));
      await sendNativeMessage(userContent(withMessageIdentity(resolvedMessage)));
    },
    [getOrCreateChat, getChat, chatIdRef, session.id, setMessages, sendNativeMessage],
  );

  const retryMessage = useCallback(async () => {
    const chat = getChat(chatIdRef.current ?? "");
    if (!chat) return;
    if (chat.id !== session.id || isLoading) return;
    const history = historyForRetry(chat.messages);
    if (!history) return;
    const native = toAIMessages(history);
    setMessages(native.slice(0, -1));
    await append(native.at(-1)!);
  }, [getChat, chatIdRef, session.id, isLoading, setMessages, append]);

  const stopStreaming = useCallback(() => {
    stop();
    clearElicitation();
    setStreamingMessage(null);
    setToolMeta({});
    setRunPhase("idle");
  }, [stop, clearElicitation]);
  const setVoiceToolCall = useCallback(
    (name: string | null, callId?: string) => {
      const id = chatIdRef.current;
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
    status,
    queuedSends: ai.queue,
    interruptState,
    pendingElicitation,
    pendingConsent,
    toolMeta,
    addMessage,
    sendMessage,
    retryMessage,
    setVoiceToolCall,
    removeQueuedMessage: ai.cancelQueued,
    stopStreaming,
    resolveElicitation,
    requestElicitation,
    updateToolMeta,
    resolveConsent,
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
