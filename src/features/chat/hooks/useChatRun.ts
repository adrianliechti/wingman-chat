import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { applyArtifactStopPolicy } from "@/features/artifacts/lib/artifact-stop-policy";
import { type FileSystemManager, resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { parseArtifactReference } from "../components/chatMessageUtils";
import type { ChatContextType } from "../context/ChatContext";
import type { useChatContext } from "./useChatContext";
import { compactIfNeeded, historyForRetry, prepareChatMessages } from "../lib/chatHistory";
import { mergeQueuedMessages, queuedSend } from "../lib/chatQueue";
import { getConfig } from "@/shared/config";
import { run as agentRun, type AgentRunEvent } from "@/shared/lib/agent";
import { getErrorInfo, isAbortError } from "@/shared/lib/errors";
import { compactThreshold } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { captureRequestContext, isUserMessage } from "@/shared/lib/requestContext";
import type { Chat, Content, Message, Model, ToolCallContent, ToolContext } from "@/shared/types/chat";
import { Role, updateToolResultMeta, withMessageIdentity } from "@/shared/types/chat";
import type { Elicitation, ElicitationResult } from "@/shared/types/elicitation";
import { useChatClassification } from "./useChatClassification";
import { useChatElicitation } from "./useChatElicitation";
import { useChatQueue } from "./useChatQueue";
import { createAttachmentLoader } from "../lib/chatAttachments";

interface Options {
  model: Model | null;
  models: Model[];
  chatId: string | null;
  chatIdRef: RefObject<string | null>;
  fsRef: RefObject<FileSystemManager | null>;
  artifactsEnabled: boolean;
  getChat: (id: string) => Chat | undefined;
  updateChat: ChatContextType["updateChat"];
  getOrCreateChat: () => Promise<{ id: string; chat: Chat; fs: FileSystemManager }>;
  chatTools: ReturnType<typeof useChatContext>["tools"];
  chatInstructions: ReturnType<typeof useChatContext>["instructions"];
  chatRuntimeContext: ReturnType<typeof useChatContext>["runtimeContext"];
}

export function useChatRun({
  model,
  models,
  chatId,
  chatIdRef,
  fsRef,
  artifactsEnabled,
  getChat,
  updateChat,
  getOrCreateChat,
  chatTools,
  chatInstructions,
  chatRuntimeContext,
}: Options) {
  const config = getConfig();
  const client = config.client;
  const { queuedSends, queuedSendsRef, replaceQueue, holdQueuedSends, takeQueuedSends, removeQueuedMessage } =
    useChatQueue();
  const { pendingElicitation, requestElicitation, resolveElicitation, completeElicitation, clearElicitation } =
    useChatElicitation();
  const { classify, pendingConsent, resolveConsent } = useChatClassification({ models, chatId, chatIdRef, updateChat });
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const updateToolMeta = useCallback((toolCallId: string, meta: Record<string, unknown>) => {
    setToolMeta((prev) => {
      const existing = prev[toolCallId];
      const merged = existing ? { ...existing, ...meta } : { ...meta };
      return { ...prev, [toolCallId]: merged };
    });
  }, []);
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const streamingMessageRef = useRef<{ chatId: string; message: Message } | null>(null);
  const streamFlushTimerRef = useRef<number | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Chat that owns the single in-flight turn, so navigating away can cancel it.
  const runningChatIdRef = useRef<string | null>(null);
  const pendingModelContextRef = useRef<Map<string, string | null>>(new Map());
  // The ref always holds the latest content (so stopStreaming can commit the
  // full partial message synchronously), but the state — and with it the whole
  // message tree — re-renders at most ~8x/s instead of once per streamed token.
  // Clearing (null) applies immediately and cancels any pending flush so stale
  // streaming content can't reappear after the turn was committed.
  const updateStreamingMessage = useCallback((msg: { chatId: string; message: Message } | null) => {
    streamingMessageRef.current = msg;
    if (msg === null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = undefined;
      setStreamingMessage(null);
      return;
    }
    if (streamFlushTimerRef.current !== undefined) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = undefined;
      setStreamingMessage(streamingMessageRef.current);
    }, 120);
  }, []);

  const updateModelContext = useCallback(async (targetChatId: string, text: string | null) => {
    if (!text?.trim()) {
      pendingModelContextRef.current.delete(targetChatId);
      return;
    }

    pendingModelContextRef.current.set(targetChatId, text.trim());
  }, []);

  const runMessageInChat = useCallback(
    async function run(id: string, message: Message | null, historyOverride?: Message[], initialTitle?: string) {
      const currentModel = model;
      if (!currentModel) {
        throw new Error("no model selected");
      }

      const history = historyOverride ?? getChat(id)?.messages ?? [];
      const loadAttachments = createAttachmentLoader(id);
      const pendingModelContext = message ? (pendingModelContextRef.current.get(id) ?? null) : null;
      if (message) pendingModelContextRef.current.delete(id);

      const runId = crypto.randomUUID();
      const runFs = artifactsEnabled ? resolveArtifactFileSystem(fsRef.current, id) : null;
      const outgoingMessage = message
        ? withMessageIdentity(appendTextContent(message, pendingModelContext), runId)
        : history.findLast(isUserMessage);
      let toolMessage = outgoingMessage;

      let conversation = message && outgoingMessage ? [...history, outgoingMessage] : [...history];

      updateChat(id, () => ({ messages: conversation }));
      setIsResponding(true);
      setRunPhase("thinking");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      runningChatIdRef.current = id;
      const ownsRun = () => abortControllerRef.current === abortController;
      const isActive = () => ownsRun() && !abortController.signal.aborted;
      let streamingAssistant = withMessageIdentity({ role: Role.Assistant, content: [] }, runId);

      classify({ id, runId, conversation, title: initialTitle, hasMessage: !!message, currentModel, abortController });

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: { id: string; name: string }): ToolContext => {
        return {
          model: currentModel.id,
          chatId: id,
          signal: abortController.signal,
          content: () =>
            (toolMessage?.content ?? []).filter(
              (p: Content) => p.type === "text" || p.type === "image" || p.type === "file",
            ) as Content[],
          sendMessage: async (appMessage: Message) => {
            if (runningChatIdRef.current === id) {
              replaceQueue((items) => [...items, queuedSend(id, withMessageIdentity(appMessage))]);
            } else {
              await run(id, appMessage, undefined, initialTitle);
            }
          },
          setContext: async (text: string | null) => {
            await updateModelContext(id, text);
          },
          elicit: (elicitation: Elicitation): Promise<ElicitationResult> => {
            return requestElicitation(currentToolCall.id, currentToolCall.name, elicitation, abortController.signal);
          },
          onElicitationComplete: (elicitationId: string) => {
            if (!isActive()) return;
            completeElicitation(elicitationId);
          },
        };
      };

      try {
        // Get tools and instructions when needed
        const tools = await chatTools();
        abortController.signal.throwIfAborted();
        if (outgoingMessage) toolMessage = (await loadAttachments([outgoingMessage], abortController.signal))[0];
        const instructions = chatInstructions();
        const requestContext = captureRequestContext(chatRuntimeContext());

        // The model can opt out with 0; the deployment threshold is a ceiling.
        const compaction = config.chat?.compaction;
        let threshold = compaction ? (currentModel.compactThreshold ?? compactThreshold(currentModel.id)) : 0;
        if (compaction?.threshold !== undefined && threshold > 0) threshold = Math.min(threshold, compaction.threshold);
        const compactMessages = async (messages: Message[], force = false) => {
          if (!(threshold > 0)) return messages;
          if (isActive()) setRunPhase("compacting");
          try {
            return await compactIfNeeded(messages, {
              threshold,
              client,
              summarizerModel: config.chat?.summarizer || currentModel.id,
              fallbackModel: currentModel.id,
              signal: abortController.signal,
              force,
            });
          } finally {
            if (isActive()) setRunPhase("thinking");
          }
        };
        try {
          const compacted = await compactMessages(conversation);
          abortController.signal.throwIfAborted();
          if (compacted !== conversation) {
            conversation = compacted;
            updateChat(id, () => ({ messages: compacted }));
          }
        } catch (error) {
          if (isAbortError(error) || abortController.signal.aborted) throw error;
          console.error("[Summary] compaction failed, continuing uncompacted", error);
        }

        const runResult = await agentRun(client, currentModel.id, instructions, conversation, tools, {
          runId,
          agentName: "chat",
          options: {
            effort: currentModel.effort,
            summary: model?.summary,
            verbosity: model?.verbosity,
            signal: abortController.signal,
          },
          prepareMessages: (msgs) => loadAttachments(prepareChatMessages(msgs, requestContext), abortController.signal),
          onContextOverflow: threshold > 0 ? (msgs) => compactMessages(msgs, true) : undefined,
          onMessagesChange: (messages) => {
            if (!isActive()) return;
            conversation = messages;
            updateChat(id, () => ({ messages }));
          },
          onEvent: (event: AgentRunEvent) => {
            if (!isActive()) return;
            if (event.type === "model.started") setRunPhase("thinking");
            else if (event.type === "model.streaming") setRunPhase("responding");
            else if (event.type === "tool.started" || event.type === "tool.updated") setRunPhase("running_tool");
            else if (event.type === "tool.completed") setRunPhase("thinking");
            else if (event.type === "verification.started") setRunPhase("running_tool");
            else if (event.type === "verification.completed") setRunPhase("thinking");
          },
          onTurnStart: () => {
            if (!isActive()) return;
            streamingAssistant = withMessageIdentity({ role: Role.Assistant, content: [] }, runId);
            updateStreamingMessage({
              chatId: id,
              message: streamingAssistant,
            });
          },
          onStream: (contentParts) => {
            if (!isActive()) return;
            updateStreamingMessage({
              chatId: id,
              message: { ...streamingAssistant, content: contentParts },
            });
          },
          onTurnEnd: () => {
            if (isActive()) updateStreamingMessage(null);
          },
          createToolContext: (toolCall: ToolCallContent) => createToolContext(toolCall),
          onToolResult: (toolResult) => {
            if (!isActive()) return;
            clearElicitation();
            // Drop live meta entries — data now lives on tool_result.meta.
            const completedIds = toolResult.content.filter((p) => p.type === "tool_result").map((p) => p.id);
            if (completedIds.length > 0) {
              setToolMeta((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const cid of completedIds) {
                  if (cid in next) {
                    delete next[cid];
                    changed = true;
                  }
                }
                return changed ? next : prev;
              });
            }
          },
          beforeFinish: async ({ runId: activeRunId, messages: runMessages, signal }) => {
            if (!runFs) return { action: "finish" as const };
            return applyArtifactStopPolicy({
              chatId: id,
              runId: activeRunId,
              messages: runMessages,
              fs: runFs,
              signal,
            });
          },
          onToolMeta: (toolCallId, meta) => {
            if (abortController.signal.aborted) return;
            if (isActive()) updateToolMeta(toolCallId, meta);
            // Also support updates after the loop has finished, patching only
            // this result in the latest stored history.
            updateChat(id, (prev) => ({
              messages: updateToolResultMeta(prev.messages, toolCallId, meta),
            }));
          },
        });
        // A stopped run may settle after another run has already started.
        // Its callbacks must not clear or overwrite the new run's state.
        if (!ownsRun()) return;
        conversation = runResult.messages;

        const aborted = runResult.status === "aborted" || abortController.signal.aborted;
        // Ensure streaming buffer is cleared after completion
        updateStreamingMessage(null);

        // If the stream was stopped by the user, don't run follow-up work
        // (title summarization etc.) on the partial conversation.
        if (aborted) {
          abortControllerRef.current = null;
          runningChatIdRef.current = null;
          holdQueuedSends(id);
          clearElicitation();
          setRunPhase("idle");
          setIsResponding(false);
          return;
        }

        if (runResult.status === "failed") {
          const error = new Error(runResult.error?.message ?? "Agent run failed");
          Object.assign(error, { code: runResult.error?.code ?? "AGENT_RUN_FAILED" });
          throw error;
        }

        const ready = takeQueuedSends(id);
        if (ready.length > 0) {
          await run(id, mergeQueuedMessages(ready), conversation, initialTitle);
          return;
        }
        if (runResult.status === "max_turns") {
          conversation = [
            ...conversation,
            withMessageIdentity(
              {
                role: Role.Assistant,
                content: [],
                error: {
                  code: "MAX_TURNS",
                  message: "This run reached its turn limit. Continue when you're ready to resume.",
                },
              },
              runId,
            ),
          ];
          updateChat(id, () => ({ messages: conversation }));
        }

        abortControllerRef.current = null;
        runningChatIdRef.current = null;
        setRunPhase("idle");
        setIsResponding(false);
      } catch (error) {
        if (!ownsRun()) return;
        if (!isAbortError(error)) console.error(error);
        setIsResponding(false);
        const aborted = abortController.signal.aborted || isAbortError(error);
        abortControllerRef.current = null;
        runningChatIdRef.current = null;
        updateStreamingMessage(null);

        // If the stream was aborted by the user, exit cleanly without
        // surfacing an error. `stopStreaming()` has already committed any
        // partial content it had buffered.
        if (aborted) {
          setRunPhase("idle");
          return;
        }

        holdQueuedSends(id);

        const { code, message } = getErrorInfo(error);

        conversation = [
          ...conversation,
          withMessageIdentity(
            {
              role: Role.Assistant,
              content: [],
              error: { code, message },
            },
            runId,
          ),
        ];

        updateChat(id, () => ({ messages: conversation }));
        setRunPhase("idle");
      }
    },
    [
      artifactsEnabled,
      getChat,
      classify,
      clearElicitation,
      completeElicitation,
      fsRef,
      updateChat,
      client,
      model,
      config.chat?.summarizer,
      config.chat?.compaction,
      config.chat?.classification,
      config.chat?.categories,
      config.chat?.risks,
      chatTools,
      chatInstructions,
      chatRuntimeContext,
      requestElicitation,
      updateModelContext,
      updateStreamingMessage,
      updateToolMeta,
      takeQueuedSends,
      holdQueuedSends,
      replaceQueue,
    ],
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
          const ingestion = await chatFs.ingestFiles(artifactFiles);
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
                await chatFs.deleteFileWithDelta(p);
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
      const identifiedMessage = withMessageIdentity(resolvedMessage);
      if (!getChat(id)) return;
      if (chatIdRef.current !== id) {
        replaceQueue((items) => [...items, { ...queuedSend(id, identifiedMessage), status: "held" }]);
        return;
      }
      if (runningChatIdRef.current === id) {
        replaceQueue((items) => [...items, queuedSend(id, identifiedMessage)]);
        return;
      }
      await runMessageInChat(id, identifiedMessage, historyOverride, chatObj.title);
    },
    [getOrCreateChat, getChat, chatIdRef, runMessageInChat, replaceQueue],
  );

  const retryMessage = useCallback(async () => {
    const chat = getChat(chatIdRef.current ?? "");
    if (!chat || runningChatIdRef.current === chat.id) return;
    const history = historyForRetry(chat.messages);
    if (history) await runMessageInChat(chat.id, null, history, chat.title);
  }, [getChat, chatIdRef, runMessageInChat]);

  const continueRun = useCallback(async () => {
    const chat = getChat(chatIdRef.current ?? "");
    if (!chat || runningChatIdRef.current) return;
    const last = chat.messages.at(-1);
    if (last?.role !== Role.Assistant || last.error?.code !== "MAX_TURNS") return;

    const history = chat.messages.slice(0, -1);
    updateChat(chat.id, () => ({ messages: history }));
    await runMessageInChat(
      chat.id,
      withMessageIdentity({ role: Role.User, content: [{ type: "text", text: "Continue." }] }),
      history,
      chat.title,
    );
  }, [getChat, chatIdRef, runMessageInChat, updateChat]);

  const sendHeldMessage = useCallback(
    async (queueId: string) => {
      const item = queuedSendsRef.current.find((candidate) => candidate.id === queueId && candidate.status === "held");
      if (!item) return;

      if (runningChatIdRef.current === item.chatId) {
        replaceQueue((items) =>
          items.map((candidate) => (candidate.id === queueId ? { ...candidate, status: "queued" } : candidate)),
        );
        return;
      }

      const targetChat = getChat(item.chatId);
      if (!targetChat) {
        removeQueuedMessage(queueId);
        return;
      }
      removeQueuedMessage(queueId);
      await runMessageInChat(item.chatId, item.message, undefined, targetChat.title);
    },
    [getChat, queuedSendsRef, removeQueuedMessage, replaceQueue, runMessageInChat],
  );

  const setVoiceToolCall = useCallback(
    (toolName: string | null, callId?: string) => {
      if (toolName === null) {
        updateStreamingMessage(null);
        setIsResponding(false);
      } else {
        const id = chatIdRef.current;
        if (!id) return;
        setIsResponding(true);
        updateStreamingMessage({
          chatId: id,
          message: {
            role: Role.Assistant,
            content: [{ type: "tool_call", id: callId ?? crypto.randomUUID(), name: toolName, arguments: "{}" }],
          },
        });
      }
    },
    [updateStreamingMessage],
  );

  const stopStreaming = useCallback(() => {
    const controller = abortControllerRef.current;

    // Detach drafts from automatic drain before aborting. The aborted run may
    // settle synchronously; held items can only be sent by an explicit action.
    const runningChatId = runningChatIdRef.current;
    if (runningChatId) holdQueuedSends(runningChatId);
    controller?.abort();
    abortControllerRef.current = null;
    runningChatIdRef.current = null;

    // Commit partial streaming content to chat
    const streaming = streamingMessageRef.current;
    if (streaming && streaming.message.content.length > 0) {
      updateChat(streaming.chatId, (prev) => ({
        messages: [...prev.messages, streaming.message],
      }));
    }

    updateStreamingMessage(null);
    setIsResponding(false);
    setRunPhase("idle");
    clearElicitation();
    setToolMeta({});
  }, [holdQueuedSends, updateChat, updateStreamingMessage, clearElicitation]);

  // Navigating to another/new chat cancels the in-flight turn (single run).
  useEffect(() => {
    const runningId = runningChatIdRef.current;
    if (runningId && runningId !== chatId) stopStreaming();
  }, [chatId, stopStreaming]);

  useEffect(() => () => stopStreaming(), [stopStreaming]);

  const status: ChatContextType["status"] = pendingElicitation ? "waiting" : runPhase;
  const visibleQueuedSends = useMemo(() => queuedSends.filter((item) => item.chatId === chatId), [queuedSends, chatId]);

  return {
    streamingMessage,
    isResponding,
    status,
    queuedSends: visibleQueuedSends,
    pendingElicitation,
    pendingConsent,
    toolMeta,
    sendMessage,
    retryMessage,
    continueRun,
    setVoiceToolCall,
    removeQueuedMessage,
    sendHeldMessage,
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
