import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { useChats } from "@/features/chat/hooks/useChats";
import { useModels } from "@/features/chat/hooks/useModels";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import { getErrorInfo } from "@/shared/lib/errors";
import type { Content, Message, Model, ToolCallContent, ToolContext } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import type { Elicitation, ElicitationResult, PendingElicitation } from "@/shared/types/elicitation";
import { useApp } from "@/shell/hooks/useApp";
import type { ChatContextType } from "./ChatContext";
import { ChatContext } from "./ChatContext";

/** Drop all messages before the last compaction item to keep API requests small. */
function pruneAtCompaction(messages: Message[]): Message[] {
  let lastCompactionIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].content.some((p) => p.type === "compaction")) {
      lastCompactionIndex = i;
      break;
    }
  }
  if (lastCompactionIndex <= 0) return [...messages];
  console.log(`[Compaction] Pruning ${lastCompactionIndex} messages before compaction item`);
  return messages.slice(lastCompactionIndex);
}

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const config = getConfig();
  const client = config.client;

  const { models, selectedModel, setSelectedModel } = useModels();
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
  const elicitationCompleteCallbacksRef = useRef<Map<string, () => void>>(new Map());
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
      resetTools();
      closeApp();

      // When starting a new chat, reset realtime model back to default
      if (!id && selectedModel?.id === "realtime") {
        setSelectedModel(models[0] ?? null);
      }
    },
    [resetTools, closeApp, selectedModel, models, setSelectedModel],
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

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: {
        id: string;
        name: string;
      }): { context: ToolContext; getResultMeta: () => Record<string, unknown> | undefined } => {
        let resultMeta: Record<string, unknown> | undefined;
        return {
          context: {
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
            setMeta: (meta: Record<string, unknown>) => {
              resultMeta = meta;
            },
            updateMeta: (meta: Record<string, unknown>) => {
              resultMeta = { ...resultMeta, ...meta };
              // Also update the persisted chat data since this may be called
              // asynchronously after the tool result message has been committed
              updateChat(id, (prev) => ({
                messages: prev.messages.map((msg) => ({
                  ...msg,
                  content: msg.content.map((part) => {
                    if (part.type === "tool_result" && part.id === currentToolCall.id) {
                      return { ...part, meta: { ...part.meta, ...meta } };
                    }
                    return part;
                  }),
                })),
              }));
            },
          },
          getResultMeta: () => resultMeta,
        };
      };

      try {
        // Get tools and instructions when needed
        const tools = await chatTools();
        const instructions = chatInstructions();

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        let running = [...conversation];
        conversation = await agentRun(client, currentModel.id, instructions, conversation, tools, {
          options: {
            effort: model?.effort,
            summary: model?.summary,
            verbosity: model?.verbosity,
            compactThreshold: model?.compactThreshold,
            signal: abortController.signal,
          },
          prepareMessages: pruneAtCompaction,
          onTurnStart: () => {
            updateStreamingMessage({ chatId: id, message: { role: Role.Assistant, content: [] } });
          },
          onStream: (contentParts) => {
            updateStreamingMessage({ chatId: id, message: { role: Role.Assistant, content: contentParts } });
          },
          onTurnEnd: (assistant) => {
            running = [...running, assistant];
            updateChat(id, () => ({ messages: running }));
            updateStreamingMessage(null);
          },
          createToolContext: (toolCall: ToolCallContent) => createToolContext(toolCall),
          onToolResult: (toolResult) => {
            running = [...running, toolResult];
            setPendingElicitation(null);
            updateChat(id, () => ({ messages: running }));
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

        if (!initialTitle || conversation.length % 3 === 0) {
          client.summarizeTitle(config.chat?.summarizer || currentModel.id, conversation).then((title) => {
            if (title) {
              updateChat(id, () => ({ title }));
            }
          });
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

    isResponding,
    stopStreaming,
    // Elicitation
    pendingElicitation,
    resolveElicitation,
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
