import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { useChats } from "@/features/chat/hooks/useChats";
import { useModels } from "@/features/chat/hooks/useModels";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import { type CategoryConfig, categorySlug, getConfig, type RiskConfig, riskSlug } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { getErrorInfo } from "@/shared/lib/errors";
import type { Content, Message, Model, ToolCallContent, ToolContext } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
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

/** Drop all messages before the last summary marker so API requests stay small. */
function pruneAtSummary(messages: Message[]): Message[] {
  const idx = messages.findLastIndex((m) => m.content.some((p) => p.type === "summary"));
  if (idx <= 0) return [...messages];
  console.log(`[Summary] Pruning ${idx} messages before summary marker`);
  return messages.slice(idx);
}

/** Rough token estimate (chars / 4). Skips binary content (images/files). */
function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === "text" || part.type === "summary") {
        chars += part.text.length;
      } else if (part.type === "reasoning") {
        chars += part.text.length + (part.summary?.length ?? 0);
      } else if (part.type === "tool_call") {
        chars += part.name.length + part.arguments.length;
      } else if (part.type === "tool_result") {
        for (const r of part.result) {
          if (r.type === "text") chars += r.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Insert a summary marker before the current turn if the conversation exceeds
 * `threshold` estimated tokens. Original user/assistant messages stay in
 * storage (the UI still shows them); only the API request gets pruned at the
 * marker by `pruneAtSummary`. Any prior summary marker is dropped so they
 * don't stack — its content is preserved by feeding it to the new summary.
 */
async function compactIfNeeded(
  conversation: Message[],
  threshold: number,
  client: Client,
  summarizerModel: string,
): Promise<Message[]> {
  if (!threshold || conversation.length < 2) return conversation;
  if (estimateTokens(conversation) < threshold) return conversation;

  // Last message is the user's just-sent turn — don't summarize it.
  const currentTurnIdx = conversation.length - 1;
  const toSummarize = conversation.slice(0, currentTurnIdx);

  console.log(
    `[Summary] Compacting ${toSummarize.length} messages (~${estimateTokens(toSummarize)} est. tokens, threshold ${threshold})`,
  );

  const summary = await client.summarizeHistory(summarizerModel, toSummarize);
  if (!summary) return conversation;

  const summaryMsg: Message = {
    role: Role.Assistant,
    content: [{ type: "summary", text: summary }],
  };
  // Keep all original messages in storage; strip prior summary markers so
  // multiple don't accumulate. pruneAtSummary slices at the latest one.
  const preserved = toSummarize.filter((m) => !m.content.some((p) => p.type === "summary"));
  return [...preserved, summaryMsg, conversation[currentTurnIdx]];
}

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
  const { renderApp, closeApp } = useApp();
  const { currentAgent } = useAgents();
  const { resetTools } = useToolsContext();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingModelContextRef = useRef<Map<string, string | null>>(new Map());

  // Keep ref in sync with state so stopStreaming can read current value synchronously
  const updateStreamingMessage = useCallback((msg: { chatId: string; message: Message } | null) => {
    streamingMessageRef.current = msg;
    setStreamingMessage(msg);
  }, []);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const agentModel = currentAgent?.model ? (models.find((m) => m.id === currentAgent.model) ?? null) : null;
  const currentChatModel = chat?.model;
  const chatModel = currentChatModel ? (models.find((m) => m.id === currentChatModel.id) ?? currentChatModel) : null;
  const model = chatModel ?? agentModel ?? selectedModel ?? models[0];
  const { tools: chatTools, instructions: chatInstructions } = useChatContext("chat", model);

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

  useEffect(() => {
    setArtifactsFileSystem(fs);
  }, [fs, setArtifactsFileSystem]);

  const createChat = useCallback(async () => {
    const newChat = await createChatHook();
    setChatId(newChat.id);
    resetTools();
    return newChat;
  }, [createChatHook, resetTools]);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const selectChat = useCallback(
    (id: string | null) => {
      if (id === chatIdRef.current) return;

      setChatId(id);
      // Clear any stale post-turn notice so prompts from one thread don't leak into another.
      setPendingConsent(null);
      resetTools();
      closeApp();

      // When starting a new chat, reset realtime model back to the last saved chat model
      if (!id && (selectedModel?.id === "realtime" || chatModel?.id === "realtime")) {
        const savedId = getSavedModelId();
        const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
        setSelectedModel(restored ?? null);
      }
    },
    [resetTools, closeApp, selectedModel, chatModel, models, setSelectedModel, getSavedModelId],
  );

  const deleteChat = useCallback(
    (id: string) => {
      deleteChatHook(id);
      if (chatId === id) {
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

  const getOrCreateChat = useCallback(async () => {
    if (!model) {
      throw new Error("no model selected");
    }

    let id = chatId;
    let chatItem = id ? chats.find((c) => c.id === id) || null : null;

    if (!chatItem) {
      chatItem = await createChatHook();
      chatItem.model = model;

      setChatId(chatItem.id);
      chatIdRef.current = chatItem.id; // update ref immediately so setVoiceToolCall sees it before re-render
      updateChat(chatItem.id, () => ({ model }));

      id = chatItem.id;
    }

    if (!id || !chatItem) {
      throw new Error("failed to create or resolve chat");
    }

    return { id, chat: chatItem };
  }, [model, createChatHook, updateChat, chatId, chats]);

  // Public helper for features (drawer, uploads, terminal) that need a
  // filesystem before the user sends their first message. Creates a chat if
  // necessary and returns a FileSystemManager bound to it — callers don't
  // need to wait for React to re-render the artifacts `fs` state.
  const ensureChat = useCallback(async () => {
    if (chat && fs) {
      return { chat, fs };
    }
    const newChat = await createChat();
    const newFs = new FileSystemManager(newChat.id);
    fsRef.current = newFs;
    return { chat: newChat, fs: newFs };
  }, [chat, fs, createChat]);

  const addMessage = useCallback(
    async (message: Message) => {
      const { id } = await getOrCreateChat();

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

  const runMessageInChat = useCallback(
    async function run(id: string, message: Message, historyOverride?: Message[], initialTitle?: string) {
      const currentModel = model;
      if (!currentModel) {
        throw new Error("no model selected");
      }

      const history = historyOverride ?? (chats.find((c) => c.id === id)?.messages || []);
      const pendingModelContext = pendingModelContextRef.current.get(id) ?? null;
      pendingModelContextRef.current.delete(id);

      const outgoingMessage = appendTextContent(message, pendingModelContext);

      let conversation = [...history, outgoingMessage];

      updateChat(id, () => ({ messages: conversation }));
      setIsResponding(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

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
      const needsTitle = !initialTitle || conversation.length % 6 === 1;
      if (needsTitle || hasCategories || hasRisks) {
        const summarizerModel = classificationCfg?.model || config.chat?.summarizer || currentModel.id;
        client
          .classifyChat(
            summarizerModel,
            conversation,
            categoryConfigs.map((c) => ({ id: categorySlug(c.name), description: c.description })),
            riskConfigs.map((r) => ({ id: riskSlug(r.name), description: r.description })),
          )
          .then(({ title, categories: detectedCategories, risks: detectedRisks }) => {
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

            if (next) {
              setPendingConsent((prev) => prev ?? next);
            }
          })
          .catch((err) => console.error("classifyChat failed", err));
      }

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: { id: string; name: string }): ToolContext => {
        return {
          model: currentModel.id,
          signal: abortController.signal,
          content: () =>
            outgoingMessage.content.filter(
              (p: Content) => p.type === "text" || p.type === "image" || p.type === "file",
            ) as Content[],
          sendMessage: async (appMessage: Message) => {
            await run(id, appMessage, conversation, initialTitle);
          },
          setContext: async (text: string | null) => {
            await updateModelContext(id, text);
          },
          elicit: (elicitation: Elicitation): Promise<ElicitationResult> => {
            return new Promise((resolve) => {
              setPendingElicitation({
                toolCallId: currentToolCall.id,
                toolName: currentToolCall.name,
                elicitation,
                resolve,
              });
            });
          },
          onElicitationComplete: (elicitationId: string) => {
            const cb = elicitationCompleteCallbacksRef.current.get(elicitationId);
            if (cb) {
              elicitationCompleteCallbacksRef.current.delete(elicitationId);
              cb();
            }
          },
          render: async () => {
            console.log("[Render] Getting iframe for tool call:", currentToolCall.id, currentToolCall.name);
            return renderApp();
          },
        };
      };

      try {
        // Get tools and instructions when needed
        const tools = await chatTools();
        const instructions = chatInstructions();

        // Proactive compaction: condense older messages into a summary marker
        // before the LLM call when the estimated token count exceeds the
        // model's threshold. The summary then survives provider/model swaps
        // because it's plain text, unlike the prior server-side compaction blob.
        if (currentModel.compactThreshold) {
          const summarizerModel = config.chat?.summarizer || currentModel.id;
          const compacted = await compactIfNeeded(conversation, currentModel.compactThreshold, client, summarizerModel);
          if (compacted !== conversation) {
            conversation = compacted;
            updateChat(id, () => ({ messages: conversation }));
          }
        }

        conversation = await agentRun(client, currentModel.id, instructions, conversation, tools, {
          options: {
            effort: model?.effort,
            summary: model?.summary,
            verbosity: model?.verbosity,
            signal: abortController.signal,
          },
          prepareMessages: pruneAtSummary,
          onTurnStart: () => {
            updateStreamingMessage({ chatId: id, message: { role: Role.Assistant, content: [] } });
          },
          onStream: (contentParts) => {
            updateStreamingMessage({ chatId: id, message: { role: Role.Assistant, content: contentParts } });
          },
          onTurnEnd: (assistant) => {
            conversation = [...conversation, assistant];
            updateChat(id, () => ({ messages: conversation }));
            updateStreamingMessage(null);
          },
          createToolContext: (toolCall: ToolCallContent) => createToolContext(toolCall),
          onToolResult: (toolResult) => {
            conversation = [...conversation, toolResult];
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
            updateChat(id, () => ({ messages: conversation }));
          },
          onToolMeta: (toolCallId, meta) => {
            setToolMeta((prev) => {
              const existing = prev[toolCallId];
              const merged = existing ? { ...existing, ...meta } : { ...meta };
              return { ...prev, [toolCallId]: merged };
            });
            // Late update after commit: also patch the persisted tool_result in place.
            updateChat(id, (prev) => ({
              messages: prev.messages.map((msg) => ({
                ...msg,
                content: msg.content.map((part) => {
                  if (part.type === "tool_result" && part.id === toolCallId) {
                    return { ...part, meta: { ...part.meta, ...meta } };
                  }
                  return part;
                }),
              })),
            }));
          },
        });

        const aborted = abortController.signal.aborted;
        abortControllerRef.current = null;

        setIsResponding(false);

        // Ensure streaming buffer is cleared after completion
        updateStreamingMessage(null);

        // If the stream was stopped by the user, don't run follow-up work
        // (title summarization etc.) on the partial conversation.
        if (aborted) {
          return;
        }
      } catch (error) {
        console.error(error);
        setIsResponding(false);
        const aborted = abortControllerRef.current?.signal.aborted ?? false;
        abortControllerRef.current = null;
        updateStreamingMessage(null);

        // If the stream was aborted by the user, exit cleanly without
        // surfacing an error. `stopStreaming()` has already committed any
        // partial content it had buffered.
        if (aborted) {
          return;
        }

        const { code, message } = getErrorInfo(error);

        conversation = [
          ...conversation,
          {
            role: Role.Assistant,
            content: [],
            error: { code, message },
          },
        ];

        updateChat(id, () => ({ messages: conversation }));
      }
    },
    [
      chats,
      updateChat,
      client,
      model,
      config.chat?.summarizer,
      config.chat?.classification,
      config.chat?.categories,
      config.chat?.risks,
      chatTools,
      chatInstructions,
      renderApp,
      updateModelContext,
      updateStreamingMessage,
    ],
  );

  const sendMessage = useCallback(
    async (message: Message, historyOverride?: Message[]) => {
      const { id, chat: chatObj } = await getOrCreateChat();
      if (!chatObj) {
        throw new Error(`Chat ${id} not found`);
      }
      await runMessageInChat(id, message, historyOverride, chatObj.title);
    },
    [getOrCreateChat, runMessageInChat],
  );

  const retryMessage = useCallback(async () => {
    if (!chat) return;
    const msgs = chat.messages;
    if (msgs.length === 0) return;

    // Find the trailing error message (assistant with error, no content)
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role !== Role.Assistant || !lastMsg.error) return;

    // Strip the error message and find the last user message to re-send
    const withoutError = msgs.slice(0, -1);
    const lastUserIndex = withoutError.findLastIndex((m) => m.role === Role.User);
    if (lastUserIndex < 0) return;

    const lastUserMessage = withoutError[lastUserIndex];
    const historyBeforeUser = withoutError.slice(0, lastUserIndex);

    // Persist the trimmed history, then re-run
    updateChat(chat.id, () => ({ messages: historyBeforeUser }));
    await runMessageInChat(chat.id, lastUserMessage, historyBeforeUser, chat.title);
  }, [chat, updateChat, runMessageInChat]);

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
        const showIndicator = (chatId: string) => {
          setIsResponding(true);
          updateStreamingMessage({
            chatId,
            message: {
              role: Role.Assistant,
              content: [{ type: "tool_call", id: callId ?? crypto.randomUUID(), name: toolName, arguments: "{}" }],
            },
          });
        };
        if (!id) {
          // Tool call arrived before any user transcript (transcription lags behind model response).
          // Create the chat eagerly so the indicator has somewhere to render.
          void getOrCreateChat().then(({ id: newId }) => showIndicator(newId));
          return;
        }
        showIndicator(id);
      }
    },
    [getOrCreateChat, updateStreamingMessage],
  );

  const requestElicitation = useCallback(
    (toolCallId: string, toolName: string, elicitation: Elicitation): Promise<ElicitationResult> => {
      return new Promise((resolve) => {
        setPendingElicitation({
          toolCallId,
          toolName,
          elicitation,
          resolve,
        });
      });
    },
    [],
  );

  const stopStreaming = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    controller.abort();
    abortControllerRef.current = null;

    // Commit partial streaming content to chat
    const streaming = streamingMessageRef.current;
    if (streaming && streaming.message.content.length > 0) {
      updateChat(streaming.chatId, (prev) => ({
        messages: [...prev.messages, streaming.message],
      }));
    }

    updateStreamingMessage(null);
    setIsResponding(false);
    setPendingElicitation(null);
    setToolMeta({});
  }, [updateChat, updateStreamingMessage]);

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,

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
    setVoiceToolCall,

    isResponding,
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

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
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
