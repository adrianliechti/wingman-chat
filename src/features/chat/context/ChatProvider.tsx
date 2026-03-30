import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { useChats } from "@/features/chat/hooks/useChats";
import { useModels } from "@/features/chat/hooks/useModels";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { getConfig } from "@/shared/config";
import type {
  Content,
  Elicitation,
  ElicitationResult,
  Message,
  Model,
  PendingElicitation,
  ToolContext,
} from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import { useApp } from "@/shell/hooks/useApp";
import type { ChatContextType } from "./ChatContext";
import { ChatContext } from "./ChatContext";

/** Drop all messages before the last compaction item to keep API requests small. */
function pruneAtCompaction(messages: Message[]): Message[] {
  let lastCompactionIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].content.some(p => p.type === 'compaction')) {
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
  const { chats, createChat: createChatHook, updateChat, deleteChat: deleteChatHook } = useChats();
  const { isAvailable: artifactsEnabled, setChatId: setArtifactsChatId } = useArtifacts();
  const { renderApp, closeApp } = useApp();
  const { currentAgent } = useAgents();
  const { resetTools } = useToolsContext();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [pendingElicitation, setPendingElicitation] = useState<PendingElicitation | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const pendingModelContextRef = useRef<Map<string, string | null>>(new Map());

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const agentModel = currentAgent?.model ? (models.find((m) => m.id === currentAgent.model) ?? null) : null;
  const chatModel = chat?.model ? (models.find((m) => m.id === chat.model!.id) ?? chat.model) : null;
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

  // Set up the artifacts filesystem for the current chat
  useEffect(() => {
    if (!artifactsEnabled) {
      setArtifactsChatId(null);
      return;
    }

    setArtifactsChatId(chat?.id ?? null);
  }, [chat?.id, artifactsEnabled, setArtifactsChatId]);

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
    },
    [resetTools, closeApp],
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

    return { id: id!, chat: chatItem! };
  }, [model, createChatHook, updateChat, setChatId, chatId, chats]);

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
    if (!text || !text.trim()) {
      pendingModelContextRef.current.delete(targetChatId);
      return;
    }

    pendingModelContextRef.current.set(targetChatId, text.trim());
  }, []);

  const runMessageInChat = useCallback(
    async function run(id: string, message: Message, historyOverride?: Message[], initialTitle?: string) {
      const history = historyOverride ?? (chats.find((c) => c.id === id)?.messages || []);
      const pendingModelContext = pendingModelContextRef.current.get(id) ?? null;
      pendingModelContextRef.current.delete(id);

      const outgoingMessage = appendTextContent(message, pendingModelContext);

      let conversation = [...history, outgoingMessage];
      let modelConversation = pruneAtCompaction(conversation);

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

        // Main completion loop to handle tool calls
        while (true) {
          // Track streaming content in-memory to avoid writing the full conversation on every token
          setStreamingMessage({ chatId: id, message: { role: Role.Assistant, content: [] } });

          const assistantMessage = await client.complete(
            model!.id,
            instructions,
            modelConversation,
            tools,
            (contentParts) => {
              setStreamingMessage({
                chatId: id,
                message: {
                  role: Role.Assistant,
                  content: contentParts,
                },
              });
            },
            {
              effort: model?.effort,
              summary: model?.summary,
              verbosity: model?.verbosity,
              compactThreshold: model?.compactThreshold,
            },
          );

          // Add the assistant message to conversation
          conversation = [...conversation, assistantMessage];
          modelConversation = pruneAtCompaction([...modelConversation, assistantMessage]);

          // Commit the completed message once per turn
          updateChat(id, () => ({ messages: conversation }));

          // Clear streaming buffer now that the message is persisted
          setStreamingMessage(null);

          // Check if there are tool calls to handle
          const toolCalls = assistantMessage.content.filter((p) => p.type === "tool_call");

          if (toolCalls.length === 0) {
            // No tool calls, we're done
            break;
          }

          // Handle each tool call
          for (const toolCall of toolCalls) {
            if (toolCall.type !== "tool_call") continue;

            const tool = tools.find((t) => t.name === toolCall.name);

            if (!tool) {
              // Tool not found - add error message as user message with tool result
              conversation = [
                ...conversation,
                {
                  role: Role.User,
                  content: [
                    {
                      type: "tool_result",
                      id: toolCall.id,
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                      result: [{ type: "text", text: `Error: Tool "${toolCall.name}" not found or not executable.` }],
                    },
                  ],
                  error: {
                    code: "TOOL_NOT_FOUND",
                    message: `Tool "${toolCall.name}" is not available or not executable.`,
                  },
                },
              ];
              modelConversation = [...modelConversation, conversation[conversation.length - 1]];

              continue;
            }

            try {
              const args = JSON.parse(toolCall.arguments || "{}");
              const { context: toolContext, getResultMeta } = createToolContext(toolCall);

              const result = await tool.function(args, toolContext);

              // Clear pending elicitation after tool completes
              setPendingElicitation(null);

              // Add tool result to conversation as user message
              const toolResultMessage: Message = {
                role: Role.User,
                content: [
                  {
                    type: "tool_result",
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    result: result,
                    ...(getResultMeta() ? { meta: getResultMeta() } : {}),
                  },
                ],
              };
              conversation = [...conversation, toolResultMessage];
              modelConversation = [...modelConversation, toolResultMessage];
            } catch (error) {
              console.error("Tool failed", error);

              // Add tool error to conversation as user message
              const toolErrorMessage: Message = {
                role: Role.User,
                content: [
                  {
                    type: "tool_result",
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    result: [{ type: "text", text: "error: tool execution failed." }],
                  },
                ],
                error: {
                  code: "TOOL_EXECUTION_ERROR",
                  message:
                    "The tool could not complete the requested action. Please try again or use a different approach.",
                },
              };
              conversation = [...conversation, toolErrorMessage];
              modelConversation = [...modelConversation, toolErrorMessage];
            }
          }

          // Update conversation with tool results before next iteration
          updateChat(id, () => ({ messages: conversation }));
        }

        setIsResponding(false);

        // Ensure streaming buffer is cleared after completion
        setStreamingMessage(null);

        if (!initialTitle || conversation.length % 3 === 0) {
          client.summarizeTitle(config.chat?.summarizer || model!.id, conversation).then((title) => {
            if (title) {
              updateChat(id, () => ({ title }));
            }
          });
        }
      } catch (error) {
        console.error(error);
        setIsResponding(false);

        if (error?.toString().includes("missing finish_reason")) {
          setStreamingMessage(null);
          return;
        }

        // Determine error code and user-friendly message based on error type
        let errorCode = "COMPLETION_ERROR";
        let errorMessage = "An unexpected error occurred while generating the response.";

        const errorString = error?.toString() || "";

        if (errorString.includes("500")) {
          errorCode = "SERVER_ERROR";
          errorMessage = "The server encountered an internal error. Please try again in a moment.";
        } else if (errorString.includes("401")) {
          errorCode = "AUTH_ERROR";
          errorMessage = "Authentication failed. Please check your API key or credentials.";
        } else if (errorString.includes("403")) {
          errorCode = "AUTH_ERROR";
          errorMessage = "Access denied. You may not have permission to use this model.";
        } else if (errorString.includes("404")) {
          errorCode = "NOT_FOUND_ERROR";
          errorMessage = "The requested model or resource was not found.";
        } else if (errorString.includes("429")) {
          errorCode = "RATE_LIMIT_ERROR";
          errorMessage = "Rate limit exceeded. Please wait a moment before trying again.";
        } else if (errorString.includes("timeout") || errorString.includes("network")) {
          errorCode = "NETWORK_ERROR";
          errorMessage = "Network connection failed. Please check your internet connection and try again.";
        }

        conversation = [
          ...conversation,
          {
            role: Role.Assistant,
            content: [],
            error: {
              code: errorCode,
              message: errorMessage,
            },
          },
        ];

        updateChat(id, () => ({ messages: conversation }));

        // Ensure streaming buffer is cleared on errors
        setStreamingMessage(null);
      }
    },
    [chats, updateChat, client, model, setIsResponding, chatTools, chatInstructions, renderApp, updateModelContext],
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

  const resolveElicitation = useCallback(
    (result: ElicitationResult) => {
      if (pendingElicitation) {
        pendingElicitation.resolve(result);
        setPendingElicitation(null);
      }
    },
    [pendingElicitation],
  );

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,

    // Chats
    chats,
    chat,
    messages,

    // Chat actions
    createChat,
    selectChat,
    deleteChat,
    updateChat,

    // Message actions
    addMessage,
    sendMessage,

    isResponding,
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
