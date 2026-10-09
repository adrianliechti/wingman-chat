import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useChat } from "@tanstack/ai-react";
import type { ChatInterruptState, ChatPersistedState, RunAgentInputContext } from "@tanstack/ai-client";
import {
  normalizeToUIMessage,
  isContentPart,
  type ContentPart,
  type StreamChunk,
  type UIMessage,
  type ModelMessage,
} from "@tanstack/ai";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { artifactVerification } from "@/features/artifacts/lib/artifactVerification";
import { uiDiagnostics } from "@/shared/lib/intelligentUi/diagnostics";
import { type FileSystemManager, resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { parseArtifactReference } from "../components/chatMessageUtils";
import type { ChatContextType } from "../context/ChatContext";
import type { useChatContext } from "./useChatContext";
import { prepareChatMessages } from "../lib/chatHistory";
import { chatCompaction, preserveSkillContext } from "../lib/chatCompaction";
import { getConfig } from "@/shared/config";
import { RunSidecar, approvalTools, streamRun } from "@/shared/lib/agent";
import { getErrorInfo, isAbortError } from "@/shared/lib/errors";
import { artifactRefPart, isUserPrompt, messageText, textMetadata, updateToolResultMeta } from "@/shared/lib/messages";
import { compactThreshold } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { captureRequestContext } from "@/shared/lib/requestContext";
import type { Chat, Model } from "@/shared/types/chat";
import { chatMetadataStore, retryHistory, withRunError } from "../lib/chatRuntime";
import type { ChatStore } from "../lib/chatStore";
import { useChatClassification } from "./useChatClassification";
import { useChatElicitation } from "./useChatElicitation";
import { createAttachmentLoader } from "../lib/chatAttachments";
import { beginMemoryRun, enqueueMemoryLearning } from "@/features/agent/lib/memoryLearning";
import { recallMemory } from "@/features/agent/lib/memoryRecall";
import { reconcileMemorySources } from "@/features/agent/lib/memorySources";

/** One native runtime per thread. The live transcript and its hydration source stay with it. */
interface Session {
  id: string;
  sidecar: RunSidecar;
  native: UIMessage[];
  hydrated: ChatPersistedState | null;
  interrupts: ChatInterruptState | null;
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
  const session = useMemo<Session>(
    () => ({ id: threadId, sidecar: new RunSidecar(), native: [], hydrated: null, interrupts: null }),
    [threadId],
  );
  const storageOwnerRef = useRef<Session | null>(session);
  useLayoutEffect(() => {
    storageOwnerRef.current = session;
    return () => {
      storageOwnerRef.current = null;
    };
  }, [session]);
  const tools = useMemo(() => approvalTools(chatTools()), [chatTools]);
  // Realtime and legacy MCP URL requests have a live transport callback.
  // Chat forms and tool approvals use ChatClient's durable interrupts below.
  const { pendingElicitation, requestElicitation, resolveElicitation, completeElicitation, clearElicitation } =
    useChatElicitation();
  const { classify, pendingConsent, resolveConsent } = useChatClassification({ models, chatId, chatIdRef, updateChat });
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: UIMessage } | null>(null);
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
      const { id, sidecar } = session;
      const runId = runContext?.runId ?? crypto.randomUUID();
      const conversation = sidecar.apply(
        nativeMessages.map((message) => normalizeToUIMessage(message, () => crypto.randomUUID())),
      );
      const outgoing = conversation.findLast(isUserPrompt);
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
            memoryContext = recallMemory(await memory.snapshot(), outgoing ? messageText(outgoing) : "");
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
          sidecar,
          middleware: [
            ...chatMiddleware(),
            ...(runFs ? [artifactVerification(runFs, sidecar, conversation)] : []),
            uiDiagnostics(conversation),
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
                    chatMetadataStore(
                      () => getChat(id)?.metadata,
                      (update) => {
                        if (runSignal.aborted) return;
                        updateChat(id, (prev) => ({ metadata: update(prev.metadata ?? {}) }), { preserveDates: true });
                      },
                      context.subagentRunId,
                    ),
                  ),
                  preserveSkillContext(),
                ]
              : [],
          options: { effort: model.effort, summary: model.summary, verbosity: model.verbosity, signal },
          prepareMessages: (messages, runSignal) =>
            loadAttachments(prepareChatMessages(messages, requestContext), runSignal),
          createToolContext: (call, execution) => ({
            chatId: id,
            content: () => (toolMessage?.parts ?? []).filter(isContentPart),
            elicit: (elicitation) => requestElicitation(call.id, call.name, elicitation, execution.abortSignal),
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

  const ai = useChat({
    threadId: session.id,
    tools,
    queue: { whenBusy: "queue", drain: "batch" },
    connection: {
      connect: (messages, _data, signal, context) => connectRef.current(session, messages, signal, context),
    },
    persistence: {
      getItem: async () => {
        const saved = getChat(session.id) ?? (chatId === session.id ? await loadChat(session.id) : undefined);
        if (!saved) return null;
        session.hydrated = { messages: saved.messages, resume: saved.resume };
        session.native = saved.messages;
        return session.hydrated;
      },
      setItem: (_key, state) => {
        // useChat stops disposed clients; their cleanup must not erase a saved
        // approval or overwrite the conversation opened by their replacement.
        if (storageOwnerRef.current !== session) return;
        // The runtime owns the live transcript; the chat store receives it as is,
        // with the rich tool outputs the runtime only holds as text.
        session.native = state.messages;
        // A draft has no durable record until the first send or attachment.
        if (!getChat(session.id)) return;
        // Skip only the unchanged hydration echo; resume-only changes (including Stop) must persist.
        const hydrated = session.hydrated;
        if (
          hydrated &&
          hydrated.resume === state.resume &&
          hydrated.messages.length === state.messages.length &&
          hydrated.messages.every((message, index) => message === state.messages[index])
        )
          return;
        session.hydrated = null;
        updateChat(session.id, () => ({ messages: session.sidecar.apply(state.messages), resume: state.resume }), {
          preserveDates: true,
        });
      },
      removeItem: () => {
        if (storageOwnerRef.current !== session) return;
        session.native = [];
        const saved = getChat(session.id);
        if (saved && (saved.messages.length || saved.resume))
          updateChat(session.id, () => ({ messages: [], resume: undefined, metadata: undefined }));
      },
    },
    onChunk: (chunk) => {
      if (chatIdRef.current !== session.id) return;
      if (chunk.type === "TEXT_MESSAGE_CONTENT") setRunPhase("responding");
      else if (chunk.type === "CUSTOM" && chunk.name === "compaction:started") setRunPhase("compacting");
      else if (chunk.type === "CUSTOM" && chunk.name === "compaction:ended") setRunPhase("thinking");
    },
    onInterruptStateChange: (state) => {
      session.interrupts = state;
    },
    onError: (error) => {
      if (isAbortError(error) || chatIdRef.current !== session.id) return;
      // A failed interrupt continuation stays on the interrupt card, which
      // retries the submission; a plain retry cannot answer it.
      if (session.interrupts?.resuming || session.interrupts?.interrupts.length) return;
      ai.setMessages(withRunError(session.native, getErrorInfo(error)));
    },
  });
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
    async (message: UIMessage, targetChatId?: string) => {
      const id = targetChatId ?? (await getOrCreateChat()).id;
      await loadChat(id);
      const chat = getChat(id);
      if (!chat) return;
      // Voice and externally produced messages enter the same live transcript.
      // A callback for an inactive conversation only updates its stored record.
      if (id === session.id && chatIdRef.current === id) {
        setMessages([...session.native, message]);
        updateChat(id, () => ({}));
      } else updateChat(id, () => ({ messages: [...chat.messages, message] }));
    },
    [getOrCreateChat, loadChat, getChat, session, chatIdRef, setMessages, updateChat],
  );

  const sendMessage = useCallback(
    async (
      message: UIMessage,
      historyOverride?: UIMessage[],
      artifactFiles?: ProcessedFile[],
      deletedPaths?: string[],
    ) => {
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
      if (historyOverride) {
        // An edited turn replaces itself and everything after it in the live transcript.
        const cut = session.native.findIndex((native) => native.id === resolvedMessage.id);
        setMessages(cut >= 0 ? session.native.slice(0, cut) : historyOverride);
      }
      await sendNativeMessage({
        id: resolvedMessage.id,
        content: resolvedMessage.parts as ContentPart[],
        metadata: resolvedMessage.metadata,
      });
    },
    [getOrCreateChat, getChat, chatIdRef, session, setMessages, sendNativeMessage],
  );

  const retryMessage = useCallback(async () => {
    if (chatIdRef.current !== session.id || isLoading) return;
    if (session.interrupts?.resuming || session.interrupts?.interrupts.length) return;
    const retry = retryHistory(session.native);
    if (!retry) return;
    setMessages(retry.history);
    await append(retry.resend);
  }, [chatIdRef, session, isLoading, setMessages, append]);

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
                id: `voice-${callId ?? name}`,
                role: "assistant",
                parts: [
                  {
                    type: "tool-call",
                    id: callId ?? crypto.randomUUID(),
                    name,
                    arguments: "{}",
                    state: "input-complete",
                  },
                ],
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
  message: UIMessage,
  pathMap: Record<string, string>,
  revisions: Record<string, string | undefined>,
): UIMessage {
  return {
    ...message,
    parts: message.parts.flatMap((part): UIMessage["parts"] => {
      if (part.type !== "text") return [part];
      const ref = textMetadata(part).artifactRef;
      if (ref) {
        const path = pathMap[ref.path] ?? ref.path;
        return [artifactRefPart({ ...ref, path, revision: revisions[path] ?? ref.revision })];
      }
      const paths = parseArtifactReference(part.content);
      if (paths.length === 0) return [part];
      return paths.map((requested) => {
        const path = pathMap[requested] ?? requested;
        return artifactRefPart({ path, revision: revisions[path], displayName: path.split("/").pop() ?? path });
      });
    }),
  };
}
