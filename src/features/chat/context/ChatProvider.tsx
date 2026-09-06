import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { applyArtifactStopPolicy } from "@/features/artifacts/lib/artifact-stop-policy";
import { FileSystemManager, resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { parseArtifactReference } from "@/features/chat/components/chatMessageUtils";
import { useChats } from "@/features/chat/hooks/useChats";
import { useModels } from "@/features/chat/hooks/useModels";
import {
  compactIfNeeded,
  historyForRetry,
  prepareChatMessages,
  sanitizeForClassification,
} from "@/features/chat/lib/chatHistory";
import { createChatCreationGate } from "@/features/chat/lib/chatCreation";
import { mergeQueuedMessages, queuedSend, type QueuedSend } from "@/features/chat/lib/chatQueue";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import { type CategoryConfig, categorySlug, getConfig, type RiskConfig, riskSlug } from "@/shared/config";
import { run as agentRun, type AgentRunEvent } from "@/shared/lib/agent";
import { getErrorInfo, isAbortError } from "@/shared/lib/errors";
import { compactThreshold, minimalEffort } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { captureRequestContext, isUserMessage } from "@/shared/lib/requestContext";
import type { Content, Message, Model, ToolCallContent, ToolContext } from "@/shared/types/chat";
import { Role, updateToolResultMeta, withMessageIdentity } from "@/shared/types/chat";
import type {
  ConsentResult,
  Elicitation,
  ElicitationResult,
  PendingConsent,
  PendingElicitation,
} from "@/shared/types/elicitation";
import { useApp } from "@/shell/hooks/useApp";
import type { ChatContextType } from "./ChatContext";
import { ChatContext } from "./ChatContext";

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const config = getConfig();
  const client = config.client;

  const { models, selectedModel, setSelectedModel, getSavedModelId } = useModels();
  const {
    chats,
    isLoaded: chatsLoaded,
    createChat: createChatHook,
    updateChat,
    deleteChat: deleteChatHook,
  } = useChats();
  const { isAvailable: artifactsEnabled, setFileSystem: setArtifactsFileSystem } = useArtifacts();
  const { closeApp } = useApp();
  const { currentAgent } = useAgents();
  const [chatId, setChatId] = useState<string | null>(null);
  const selectionVersionRef = useRef(0);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [queuedSends, setQueuedSends] = useState<QueuedSend[]>([]);
  const queuedSendsRef = useRef<QueuedSend[]>([]);
  const replaceQueue = useCallback((update: (items: QueuedSend[]) => QueuedSend[]) => {
    const next = update(queuedSendsRef.current);
    queuedSendsRef.current = next;
    setQueuedSends(next);
    return next;
  }, []);
  const [pendingElicitation, setPendingElicitation] = useState<PendingElicitation | null>(null);
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const updateToolMeta = useCallback((toolCallId: string, meta: Record<string, unknown>) => {
    setToolMeta((prev) => {
      const existing = prev[toolCallId];
      const merged = existing ? { ...existing, ...meta } : { ...meta };
      return { ...prev, [toolCallId]: merged };
    });
  }, []);
  const elicitationCompleteCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  // chatId -> set of category ids the user has accepted in this session. Intentionally not persisted.
  const consentedCategoriesRef = useRef<Map<string, Set<string>>>(new Map());
  // chatId -> set of risk ids already acknowledged in this session (avoid repeating the same warning on every turn).
  const acknowledgedRisksRef = useRef<Map<string, Set<string>>>(new Map());
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const streamingMessageRef = useRef<{ chatId: string; message: Message } | null>(null);
  const streamFlushTimerRef = useRef<number | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Chat that owns the single in-flight turn, so navigating away can cancel it.
  const runningChatIdRef = useRef<string | null>(null);
  const pendingModelContextRef = useRef<Map<string, string | null>>(new Map());
  const latestRunByChatRef = useRef(new Map<string, string>());

  const holdQueuedSends = useCallback(
    (targetChatId: string) => {
      replaceQueue((items) =>
        items.map((item) =>
          item.chatId === targetChatId && item.status === "queued" ? { ...item, status: "held" } : item,
        ),
      );
    },
    [replaceQueue],
  );

  const takeQueuedSends = useCallback(
    (targetChatId: string): QueuedSend[] => {
      const ready = queuedSendsRef.current.filter((item) => item.chatId === targetChatId && item.status === "queued");
      if (ready.length > 0) {
        replaceQueue((items) => items.filter((item) => !ready.some((queued) => queued.id === item.id)));
      }
      return ready;
    },
    [replaceQueue],
  );

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

  const chat = chats.find((c) => c.id === chatId) ?? null;
  // Realtime events can deliver the user transcription and response.done within
  // the same render. Keep the active chat available synchronously so both
  // callbacks append to the same newly-created conversation.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const createChatOnce = useMemo(() => createChatCreationGate(), []);
  const agentModel = currentAgent?.model ? (models.find((m) => m.id === currentAgent.model) ?? null) : null;
  const currentChatModel = chat?.model;
  // Resolve to the fresh config model so tools/instructions/supportedEfforts stay
  // current, but keep the chat's stored `effort` (the per-chat selection, which
  // starts at the model's configured default and the user can change in the picker).
  // Memoized so the effort overlay doesn't mint a new `model` object every render
  // (which would thrash useChatContext and other model-keyed memos on each token).
  const chatModel = useMemo(() => {
    if (!currentChatModel) return null;
    const resolved = models.find((m) => m.id === currentChatModel.id) ?? currentChatModel;
    return "effort" in currentChatModel ? { ...resolved, effort: currentChatModel.effort } : resolved;
  }, [models, currentChatModel]);
  const model = chatModel ?? agentModel ?? selectedModel ?? models[0];
  const {
    tools: chatTools,
    instructions: chatInstructions,
    runtimeContext: chatRuntimeContext,
  } = useChatContext("chat", model, models);

  useEffect(() => {
    setInterpreterModel(model?.id ?? null);
  }, [model?.id]);

  const messages = useMemo(() => {
    const baseMessages = chat?.messages ?? [];

    // Attach transient streaming content without persisting it on every token
    if (streamingMessage && chat?.id === streamingMessage.chatId) {
      return [...baseMessages, streamingMessage.message];
    }

    return baseMessages;
  }, [chat?.messages, chat?.id, streamingMessage]);

  // Own the FileSystemManager lifecycle: one instance per active chat, pushed
  // into the artifacts context. The artifacts feature has no chat knowledge;
  // it just receives the filesystem and reacts to its identity changes.
  // The ref lets ensureChat eagerly create an instance that the next render's
  // useMemo will pick up, so both paths share the same object.
  const fsRef = useRef<FileSystemManager | null>(null);
  const fs = useMemo(() => {
    if (!artifactsEnabled || !chat?.id) {
      fsRef.current = null;
      return null;
    }
    if (fsRef.current?.chatId === chat.id) {
      return fsRef.current;
    }
    const next = new FileSystemManager(chat.id);
    fsRef.current = next;
    return next;
  }, [artifactsEnabled, chat?.id]);

  useLayoutEffect(() => {
    setArtifactsFileSystem(fs);
  }, [fs, setArtifactsFileSystem]);

  const createChat = useCallback(async () => {
    const version = ++selectionVersionRef.current;
    const newChat = await createChatHook();
    if (version === selectionVersionRef.current) {
      chatRef.current = newChat;
      chatIdRef.current = newChat.id;
      setChatId(newChat.id);
    }
    return newChat;
  }, [createChatHook]);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const selectChat = useCallback(
    (id: string | null) => {
      if (id === chatIdRef.current) return;

      selectionVersionRef.current++;
      chatIdRef.current = id;
      setChatId(id);
      // Clear any stale post-turn notice so prompts from one thread don't leak into another.
      setPendingConsent(null);
      void closeApp();

      // When starting a new chat, reset realtime model back to the last saved chat model
      if (!id && (selectedModel?.id === "realtime" || chatModel?.id === "realtime")) {
        const savedId = getSavedModelId();
        const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
        setSelectedModel(restored ?? null);
      }
    },
    [closeApp, selectedModel, chatModel, models, setSelectedModel, getSavedModelId],
  );

  const deleteChat = useCallback(
    (id: string) => {
      deleteChatHook(id);
      if (chatId === id) {
        selectionVersionRef.current++;
        chatIdRef.current = null;
        setChatId(null);
      }
    },
    [deleteChatHook, chatId],
  );

  const setModel = useCallback(
    (model: Model | null) => {
      if (chat) {
        updateChat(chat.id, () => ({ model }));
        // Also remember the last chat model globally so new chats / mode
        // toggles can restore it.
        setSelectedModel(model);
      } else {
        setSelectedModel(model);
      }
    },
    [chat, updateChat, setSelectedModel],
  );

  // Per-chat reasoning effort selection. Stored as `effort` on the chat's model
  // so it rides the existing `chat.model` persistence; it starts at the model's
  // configured default and overrides it for this chat. null clears it.
  const setEffort = useCallback(
    (effort: Model["effort"] | null) => {
      if (!model) return;
      const next: Model = { ...model, effort: effort ?? undefined };
      setModel(next);
    },
    [model, setModel],
  );

  // Single chat-creation path. Returns the active chat (creating it if needed)
  // together with its `FileSystemManager`. The fs is bound eagerly and cached
  // in `fsRef` so callers get it without waiting for React to re-derive `fs`.
  // Used by message sending, addMessage, and ensureChat alike — there is no
  // separate creation logic. Tool selections are sticky (persisted), so any
  // toggled while composing carry into the first turn.
  const getOrCreateChat = useCallback(async () => {
    if (!model) {
      throw new Error("no model selected");
    }

    const existingId = chatIdRef.current;
    const selectionVersion = selectionVersionRef.current;
    let chatItem = existingId
      ? chatRef.current?.id === existingId
        ? chatRef.current
        : chats.find((c) => c.id === existingId)
      : undefined;
    if (!chatItem) {
      chatItem = await createChatOnce(createChatHook);
      chatItem.model = model;
      // Saving a new chat can outlast navigation. The caller still owns its
      // new workspace, but must not replace the user's newer selection.
      if (selectionVersion === selectionVersionRef.current) {
        chatRef.current = chatItem;
        chatIdRef.current = chatItem.id;
        setChatId(chatItem.id);
      }
      updateChat(chatItem.id, () => ({ model }));
    }

    const fsForChat = fsRef.current?.chatId === chatItem.id ? fsRef.current : new FileSystemManager(chatItem.id);
    if (chatIdRef.current === chatItem.id) {
      fsRef.current = fsForChat;
      // Uploads can finish before React renders the newly created chat.
      // Bind eagerly so selecting their result uses this same workspace.
      if (artifactsEnabled) setArtifactsFileSystem(fsForChat);
    }

    return { id: chatItem.id, chat: chatItem, fs: fsForChat };
  }, [model, createChatHook, createChatOnce, updateChat, chats, artifactsEnabled, setArtifactsFileSystem]);

  // Public alias for features (drawer, terminal, attachment sends) that need a
  // filesystem before the user's first message — same creation path as sending.
  const ensureChat = useCallback(async () => {
    const { chat: ensuredChat, fs: ensuredFs } = await getOrCreateChat();
    return { chat: ensuredChat, fs: ensuredFs };
  }, [getOrCreateChat]);

  const addMessage = useCallback(
    async (message: Message, targetChatId?: string) => {
      const id = targetChatId ?? (await getOrCreateChat()).id;

      // Use the updater pattern to get fresh messages from the chat
      updateChat(id, (currentChat) => ({
        messages: [...(currentChat.messages || []), message],
      }));
    },
    [getOrCreateChat, updateChat],
  );

  const updateModelContext = useCallback(async (targetChatId: string, text: string | null) => {
    if (!text?.trim()) {
      pendingModelContextRef.current.delete(targetChatId);
      return;
    }

    pendingModelContextRef.current.set(targetChatId, text.trim());
  }, []);

  const requestElicitation = useCallback(
    (
      toolCallId: string,
      toolName: string,
      elicitation: Elicitation,
      signal?: AbortSignal,
    ): Promise<ElicitationResult> => {
      if (signal?.aborted) return Promise.resolve({ action: "cancel" });
      return new Promise((resolve) => {
        const finish = (result: ElicitationResult) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const onAbort = () => {
          setPendingElicitation((pending) => (pending?.toolCallId === toolCallId ? null : pending));
          finish({ action: "cancel" });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setPendingElicitation({
          toolCallId,
          toolName,
          elicitation,
          resolve: finish,
        });
      });
    },
    [],
  );

  const runMessageInChat = useCallback(
    async function run(id: string, message: Message | null, historyOverride?: Message[], initialTitle?: string) {
      const currentModel = model;
      if (!currentModel) {
        throw new Error("no model selected");
      }

      const history = historyOverride ?? (chats.find((c) => c.id === id)?.messages || []);
      const pendingModelContext = message ? (pendingModelContextRef.current.get(id) ?? null) : null;
      if (message) pendingModelContextRef.current.delete(id);

      const runId = crypto.randomUUID();
      latestRunByChatRef.current.set(id, runId);
      const runFs = artifactsEnabled ? resolveArtifactFileSystem(fsRef.current, id) : null;
      const outgoingMessage = message
        ? withMessageIdentity(appendTextContent(message, pendingModelContext), runId)
        : history.findLast(isUserMessage);

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

      // Kick off the combined title + classification call in parallel with the model turn so
      // the consent/risk overlay can appear as soon as the user hits send, without waiting for
      // the stream. When categories or risks are configured we run every turn for detection
      // (and refresh the title every turn for free). With neither configured we keep the
      // original initial + every-3-user-turns cadence.
      const categoryConfigs = config.chat?.categories ?? [];
      const riskConfigs = config.chat?.risks ?? [];
      const classificationCfg = config.chat?.classification;
      const defaultThreshold = classificationCfg?.threshold ?? 0.5;
      const hasCategories = categoryConfigs.length > 0;
      const hasRisks = riskConfigs.length > 0;
      const userTurnCount = conversation.filter(isUserMessage).length;
      const needsTitle = !initialTitle || userTurnCount % 3 === 1;
      if (message && (needsTitle || hasCategories || hasRisks)) {
        const classificationModel = classificationCfg?.model || config.chat?.summarizer || currentModel.id;
        const classificationEffort =
          classificationCfg?.effort ??
          minimalEffort(models.find((model) => model.id === classificationModel) ?? classificationModel);
        client
          .classifyChat(
            classificationModel,
            // Classification concerns user intent, not tool implementation or
            // output. Keep only recent prose and lightweight media placeholders.
            sanitizeForClassification(conversation),
            categoryConfigs.map((c) => ({ id: categorySlug(c.name), description: c.description })),
            riskConfigs.map((r) => ({ id: riskSlug(r.name), description: r.description })),
            { effort: classificationEffort, signal: abortController.signal },
          )
          .then(({ title, categories: detectedCategories, risks: detectedRisks }) => {
            if (abortController.signal.aborted || latestRunByChatRef.current.get(id) !== runId) return;
            if (title) {
              updateChat(id, () => ({ title }));
            }

            // Risks take precedence over category consent — they're more severe.
            let next: PendingConsent | null = null;
            if (detectedRisks.length > 0 && hasRisks) {
              const acknowledged = acknowledgedRisksRef.current.get(id) ?? new Set<string>();
              const matchedRisk = detectedRisks
                .map((match) => {
                  const cfg = riskConfigs.find((r) => riskSlug(r.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: RiskConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .filter(({ cfg }) => !acknowledged.has(riskSlug(cfg.name)))
                // Show the highest-confidence unacknowledged risk first.
                .sort((a, b) => b.confidence - a.confidence)[0];

              if (matchedRisk) {
                const { cfg } = matchedRisk;
                next = {
                  kind: "risk",
                  id: riskSlug(cfg.name),
                  name: cfg.name,
                  consent: {
                    message:
                      cfg.message ??
                      `This request appears to involve "${cfg.name}", which may require special attention. Please review before continuing.`,
                    severity: cfg.severity ?? "medium",
                  },
                  resolve: () => {},
                };
              }
            }

            if (!next && detectedCategories.length > 0 && hasCategories) {
              const consented = consentedCategoriesRef.current.get(id) ?? new Set<string>();
              const toAsk = detectedCategories
                .map((match) => {
                  const cfg = categoryConfigs.find((c) => categorySlug(c.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: CategoryConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .find(({ cfg }) => !!cfg.consent && !consented.has(categorySlug(cfg.name)));

              if (toAsk) {
                const customText = typeof toAsk.cfg.consent === "string" ? toAsk.cfg.consent : null;
                next = {
                  kind: "category",
                  id: categorySlug(toAsk.cfg.name),
                  name: toAsk.cfg.name,
                  consent: {
                    message:
                      customText ?? `This conversation appears to be about "${toAsk.cfg.name}". Please acknowledge.`,
                  },
                  resolve: () => {},
                };
              }
            }

            if (next && chatIdRef.current === id) {
              setPendingConsent((prev) => prev ?? next);
            }
          })
          .catch((err) => {
            if (!isAbortError(err)) console.error("classifyChat failed", err);
          });
      }

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: { id: string; name: string }): ToolContext => {
        return {
          model: currentModel.id,
          chatId: id,
          signal: abortController.signal,
          content: () =>
            (outgoingMessage?.content ?? []).filter(
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
            const cb = elicitationCompleteCallbacksRef.current.get(elicitationId);
            if (cb) {
              elicitationCompleteCallbacksRef.current.delete(elicitationId);
              cb();
            }
          },
        };
      };

      try {
        // Get tools and instructions when needed
        const tools = await chatTools();
        abortController.signal.throwIfAborted();
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
          prepareMessages: (msgs) => prepareChatMessages(msgs, requestContext),
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
            setPendingElicitation(null);
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
            const studioEnabled = tools.some((tool) => tool.name === "declare_artifact");
            if (!runFs || !studioEnabled) return { action: "finish" as const };
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
          setPendingElicitation(null);
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
      chats,
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
      if (runningChatIdRef.current === id) {
        replaceQueue((items) => [...items, queuedSend(id, identifiedMessage)]);
        return;
      }
      await runMessageInChat(id, identifiedMessage, historyOverride, chatObj.title);
    },
    [getOrCreateChat, runMessageInChat, replaceQueue],
  );

  const retryMessage = useCallback(async () => {
    if (!chat || runningChatIdRef.current === chat.id) return;
    const history = historyForRetry(chat.messages);
    if (history) await runMessageInChat(chat.id, null, history, chat.title);
  }, [chat, runMessageInChat]);

  const continueRun = useCallback(async () => {
    if (!chat || isResponding) return;
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
  }, [chat, isResponding, runMessageInChat, updateChat]);

  const removeQueuedMessage = useCallback(
    (id: string) => {
      replaceQueue((items) => items.filter((item) => item.id !== id));
    },
    [replaceQueue],
  );

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

      const targetChat = chats.find((candidate) => candidate.id === item.chatId);
      if (!targetChat) {
        removeQueuedMessage(queueId);
        return;
      }
      removeQueuedMessage(queueId);
      await runMessageInChat(item.chatId, item.message, undefined, targetChat.title);
    },
    [chats, removeQueuedMessage, replaceQueue, runMessageInChat],
  );

  const resolveElicitation = useCallback(
    (result: ElicitationResult) => {
      if (!pendingElicitation) return;

      const elicitation = pendingElicitation.elicitation;

      if (elicitation.mode === "url") {
        if (pendingElicitation.waiting) {
          // User cancelled while waiting — resolve the MCP promise now and clean up
          pendingElicitation.resolve({ action: "cancel" });
          elicitationCompleteCallbacksRef.current.delete(elicitation.elicitationId);
          setPendingElicitation(null);
          return;
        }

        if (result.action === "accept") {
          const resolve = pendingElicitation.resolve;
          setPendingElicitation((prev) => (prev ? { ...prev, waiting: true } : null));

          if (elicitationCompleteCallbacksRef.current.size > 0) {
            elicitationCompleteCallbacksRef.current.clear();
          }
          elicitationCompleteCallbacksRef.current.set(elicitation.elicitationId, () => {
            resolve({ action: "accept" });
            setPendingElicitation((prev) => (prev ? { ...prev, waiting: false, completed: true } : null));
            window.setTimeout(() => {
              setPendingElicitation(null);
            }, 1500);
          });
          return;
        }
      }

      pendingElicitation.resolve(result);
      setPendingElicitation(null);
    },
    [pendingElicitation],
  );

  const resolveConsent = useCallback(
    (result: ConsentResult) => {
      setPendingConsent((prev) => {
        if (!prev) return prev;
        if (result.action === "accept" && chatId) {
          const ref = prev.kind === "risk" ? acknowledgedRisksRef : consentedCategoriesRef;
          const set = ref.current.get(chatId) ?? new Set<string>();
          set.add(prev.id);
          ref.current.set(chatId, set);
        }
        return null;
      });
    },
    [chatId],
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
    if (!controller) return;

    // Detach drafts from automatic drain before aborting. The aborted run may
    // settle synchronously; held items can only be sent by an explicit action.
    const runningChatId = runningChatIdRef.current;
    if (runningChatId) holdQueuedSends(runningChatId);
    controller.abort();
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
    setPendingElicitation(null);
    elicitationCompleteCallbacksRef.current.clear();
    setToolMeta({});
  }, [holdQueuedSends, updateChat, updateStreamingMessage]);

  // Navigating to another/new chat cancels the in-flight turn (single run).
  useEffect(() => {
    const runningId = runningChatIdRef.current;
    if (runningId && runningId !== chatId) stopStreaming();
  }, [chatId, stopStreaming]);

  const status: ChatContextType["status"] = pendingElicitation ? "waiting" : runPhase;
  const visibleQueuedSends = queuedSends.filter((item) => item.chatId === chatId);

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,
    effort: model?.effort ?? null,
    setEffort,

    // Chats
    chats,
    chatsLoaded,
    chat,
    messages,

    // Chat actions
    createChat,
    selectChat,
    deleteChat,
    updateChat,
    ensureChat,

    // Message actions
    addMessage,
    sendMessage,
    retryMessage,
    continueRun,
    setVoiceToolCall,

    isResponding,
    status,
    queuedSends: visibleQueuedSends,
    removeQueuedMessage,
    sendHeldMessage,
    stopStreaming,
    // Elicitation
    pendingElicitation,
    resolveElicitation,
    requestElicitation,
    toolMeta,
    updateToolMeta,

    pendingConsent,
    resolveConsent,
  };

  return <ChatContext value={value}>{children}</ChatContext>;
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
