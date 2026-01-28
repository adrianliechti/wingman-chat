import { useState, useCallback, useMemo, useEffect } from "react";
import { Role } from "../types/chat";
import type { Message, ToolProvider, Model, ToolContext, PendingElicitation, ElicitationResult, Elicitation, Content } from '../types/chat';
import { ProviderState } from '../types/chat';
import { useModels } from "../hooks/useModels";
import { useChats } from "../hooks/useChats";
import { useChatContext } from "../hooks/useChatContext";
import { useArtifacts } from "../hooks/useArtifacts";
import { useApp } from "../hooks/useApp";
import { useToolsContext } from "../hooks/useToolsContext";
import { getConfig } from "../config";
import { ChatContext } from './ChatContext';
import type { ChatContextType } from './ChatContext';

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const config = getConfig();
  const client = config.client;

  const { models, selectedModel, setSelectedModel } = useModels();
  const { chats, createChat: createChatHook, updateChat, deleteChat: deleteChatHook } = useChats();
  const { isAvailable: artifactsEnabled, setChatId: setArtifactsChatId } = useArtifacts();
  const { getIframe, showDrawer } = useApp();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [pendingElicitation, setPendingElicitation] = useState<PendingElicitation | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);

  const chat = chats.find(c => c.id === chatId) ?? null;
  const model = chat?.model ?? selectedModel ?? models[0];
  const { tools: chatTools, instructions: chatInstructions } = useChatContext('chat', model);
  const { providers, getProviderState, setProviderEnabled } = useToolsContext();

  // Calculate tool providers connection state
  const isInitializing = useMemo(() => {
    const hasProviders = providers.length > 0;
    if (!hasProviders) {
      return null; // No providers configured
    }
    const isAnyInitializing = providers.some((p: ToolProvider) => getProviderState(p.id) === ProviderState.Initializing);
    if (isAnyInitializing) {
      return true; // At least one provider is initializing
    }
    return false; // All providers are ready
  }, [providers, getProviderState]);

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
    // Disable all tools when creating a new chat to prevent accidental usage
    providers.forEach((p: ToolProvider) => setProviderEnabled(p.id, false));
    return newChat;
  }, [createChatHook, providers, setProviderEnabled]);

  const selectChat = useCallback((chatId: string) => {
    setChatId(chatId);
    // Disable all tools when switching chats to prevent accidental usage
    providers.forEach((p: ToolProvider) => setProviderEnabled(p.id, false));
  }, [providers, setProviderEnabled]);

  const deleteChat = useCallback(
    (id: string) => {
      deleteChatHook(id);
      if (chatId === id) {
        setChatId(null);
      }
    },
    [deleteChatHook, chatId]
  );

  const setModel = useCallback((model: Model | null) => {
    if (chat) {
      updateChat(chat.id, () => ({ model }));
    } else {
      setSelectedModel(model);
    }
  }, [chat, updateChat, setSelectedModel]);

  const getOrCreateChat = useCallback(async () => {
    if (!model) {
      throw new Error('no model selected');
    }

    let id = chatId;
    let chatItem = id ? chats.find(c => c.id === id) || null : null;

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
        messages: [...(currentChat.messages || []), message]
      }));
    },
    [getOrCreateChat, updateChat]
  );

  const sendMessage = useCallback(
    async (message: Message, historyOverride?: Message[]) => {
      const { id, chat: chatObj } = await getOrCreateChat();

      const history = historyOverride ?? (chats.find(c => c.id === id)?.messages || []);
      let conversation = [...history, message];

      updateChat(id, () => ({ messages: conversation }));
      setIsResponding(true);

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: { id: string; name: string }): ToolContext => ({
        content: () => message.content.filter(p => 
          p.type === 'text' || p.type === 'image' || p.type === 'file'
        ) as Content[],
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
        render: async (): Promise<HTMLIFrameElement> => {
          console.log('[Render] Getting iframe for tool call:', currentToolCall.id, currentToolCall.name);
          
          // Get the persistent iframe from the drawer
          const iframe = getIframe();
          
          if (!iframe) {
            throw new Error('App drawer iframe not available. Make sure the drawer is mounted.');
          }
          
          // Show the drawer when rendering
          showDrawer();
          
          return iframe;
        }
      });

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
            conversation,
            tools,
            (contentParts) => {
              setStreamingMessage({ 
                chatId: id, 
                message: { 
                  role: Role.Assistant, 
                  content: contentParts
                } 
              });
            },
            {
              effort: model?.effort,
              summary: model?.summary,
              verbosity: model?.verbosity,
            }
          );

          // Add the assistant message to conversation
          conversation = [...conversation, assistantMessage];

          // Commit the completed message once per turn
          updateChat(id, () => ({ messages: conversation }));

          // Clear streaming buffer now that the message is persisted
          setStreamingMessage(null);

          // Check if there are tool calls to handle
          const toolCalls = assistantMessage.content.filter(p => p.type === 'tool_call');

          if (toolCalls.length === 0) {
            // No tool calls, we're done
            break;
          }

          // Handle each tool call
          for (const toolCall of toolCalls) {
            if (toolCall.type !== 'tool_call') continue;
            
            const tool = tools.find((t) => t.name === toolCall.name);

            if (!tool) {
              // Tool not found - add error message as user message with tool result
              conversation = [...conversation, {
                role: Role.User,
                content: [{
                  type: 'tool_result',
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  result: [{ type: 'text', text: `Error: Tool "${toolCall.name}" not found or not executable.` }]
                }],
                error: {
                  code: 'TOOL_NOT_FOUND',
                  message: `Tool "${toolCall.name}" is not available or not executable.`
                },
              }];

              continue;
            }

            try {
              const args = JSON.parse(toolCall.arguments || "{}");
              const toolContext = createToolContext(toolCall);

              const result = await tool.function(args, toolContext);

              // Clear pending elicitation after tool completes
              setPendingElicitation(null);

              // Add tool result to conversation as user message
              conversation = [...conversation, {
                role: Role.User,
                content: [{
                  type: 'tool_result',
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  result: result,
                }],
              }];
            }
            catch (error) {
              console.error("Tool failed", error);

              // Add tool error to conversation as user message
              conversation = [...conversation, {
                role: Role.User,
                content: [{
                  type: 'tool_result',
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  result: [{ type: 'text', text: 'error: tool execution failed.' }]
                }],
                error: {
                  code: 'TOOL_EXECUTION_ERROR',
                  message: 'The tool could not complete the requested action. Please try again or use a different approach.'
                },
              }];
            }
          }

          // Update conversation with tool results before next iteration
          updateChat(id, () => ({ messages: conversation }));
        }

        setIsResponding(false);

        // Ensure streaming buffer is cleared after completion
        setStreamingMessage(null);

        if (!chatObj.title || conversation.length % 3 === 0) {
          client
            .summarizeTitle(model!.id, conversation)
            .then(title => {
              if (title) {
                updateChat(id, () => ({ title }));
              }
            });
        }
      } catch (error) {
        console.error(error);
        setIsResponding(false);

        if (error?.toString().includes('missing finish_reason')) {
          setStreamingMessage(null);
          return;
        }

        // Determine error code and user-friendly message based on error type
        let errorCode = 'COMPLETION_ERROR';
        let errorMessage = 'An unexpected error occurred while generating the response.';

        const errorString = error?.toString() || '';

        if (errorString.includes('500')) {
          errorCode = 'SERVER_ERROR';
          errorMessage = 'The server encountered an internal error. Please try again in a moment.';
        } else if (errorString.includes('401')) {
          errorCode = 'AUTH_ERROR';
          errorMessage = 'Authentication failed. Please check your API key or credentials.';
        } else if (errorString.includes('403')) {
          errorCode = 'AUTH_ERROR';
          errorMessage = 'Access denied. You may not have permission to use this model.';
        } else if (errorString.includes('404')) {
          errorCode = 'NOT_FOUND_ERROR';
          errorMessage = 'The requested model or resource was not found.';
        } else if (errorString.includes('429')) {
          errorCode = 'RATE_LIMIT_ERROR';
          errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
        } else if (errorString.includes('timeout') || errorString.includes('network')) {
          errorCode = 'NETWORK_ERROR';
          errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        }

        conversation = [...conversation, {
          role: Role.Assistant,
          content: [],
          error: {
            code: errorCode,
            message: errorMessage
          }
        }];

        updateChat(id, () => ({ messages: conversation }));

        // Ensure streaming buffer is cleared on errors
        setStreamingMessage(null);
      }
    }, [getOrCreateChat, chats, updateChat, client, model, setIsResponding, chatTools, chatInstructions, getIframe, showDrawer]);



  const resolveElicitation = useCallback((result: ElicitationResult) => {
    if (pendingElicitation) {
      pendingElicitation.resolve(result);
      setPendingElicitation(null);
    }
  }, [pendingElicitation]);

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
    isInitializing,

    // Elicitation
    pendingElicitation,
    resolveElicitation,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
