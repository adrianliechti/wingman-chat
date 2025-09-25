import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Role } from "../types/chat";
import type { Message, Model, ToolContext } from "../types/chat";
import type { FileSystem } from "../types/file";
import { useModels } from "../hooks/useModels";
import { useChats } from "../hooks/useChats";
import { useChatContext } from "../hooks/useChatContext";
import { useSearch } from "../hooks/useSearch";
import { useArtifacts } from "../hooks/useArtifacts";
import { getConfig } from "../config";
import { parseResource } from "../lib/resource";
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
  const { setEnabled: setSearchEnabled } = useSearch();
  const { isAvailable: artifactsEnabled, setFileSystemForChat } = useArtifacts();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const messagesRef = useRef<Message[]>([]);

  const chat = chats.find(c => c.id === chatId) ?? null;
  const model = chat?.model ?? selectedModel ?? models[0];
  const { tools: chatTools, instructions: chatInstructions } = useChatContext('chat', model);
  const messages = useMemo(() => {
    const msgs = chat?.messages ?? [];
    messagesRef.current = msgs;
    return msgs;
  }, [chat?.messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Set up the filesystem for the current chat
  useEffect(() => {
    if (!chat?.id || !artifactsEnabled) {
      setFileSystemForChat(null, null);
      return;
    }

    // Create focused methods for filesystem access
    const getFileSystem = () => chat.artifacts || {};
    const setFileSystem = (artifacts: FileSystem) => {
      updateChat(chat.id, () => ({ artifacts }));
    };

    setFileSystemForChat(getFileSystem, setFileSystem);
  }, [chat?.id, chat?.artifacts, artifactsEnabled, setFileSystemForChat, updateChat]);

  const createChat = useCallback(() => {
    const newChat = createChatHook();
    setChatId(newChat.id);
    // Disable search when creating a new chat to prevent accidental usage
    setSearchEnabled(false);
    return newChat;
  }, [createChatHook, setSearchEnabled]);

  const selectChat = useCallback((chatId: string) => {
    setChatId(chatId);
    // Disable search when switching chats to prevent accidental usage
    setSearchEnabled(false);
  }, [setSearchEnabled]);

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

  const getOrCreateChat = useCallback(() => {
    if (!model) {
      throw new Error('no model selected');
    }

    let id = chatId;
    let chatItem = id ? chats.find(c => c.id === id) || null : null;

    if (!chatItem) {
      chatItem = createChatHook();
      chatItem.model = model;

      setChatId(chatItem.id);
      updateChat(chatItem.id, () => ({ model }));

      id = chatItem.id;
    }

    return { id: id!, chat: chatItem! };
  }, [model, createChatHook, updateChat, setChatId, chatId, chats]);

  const addMessage = useCallback(
    (message: Message) => {
      const { id } = getOrCreateChat();
      
      const currentMessages = messagesRef.current;
      const updatedMessages = [...currentMessages, message];
      
      messagesRef.current = updatedMessages;
      updateChat(id, () => ({ messages: updatedMessages }));
    },
    [getOrCreateChat, updateChat]
  );

  const sendMessage = useCallback(
    async (message: Message) => {
      const { id, chat: chatObj } = getOrCreateChat();

      const history = chats.find(c => c.id === id)?.messages || [];
      let conversation = [...history, message];

      updateChat(id, () => ({ messages: conversation }));
      setIsResponding(true);

      // Create tool context with current message attachments
      const toolContext: ToolContext = {
        attachments: () => message.attachments || []
      };

      try {
        // Main completion loop to handle tool calls
        while (true) {
          // Create empty assistant message for this completion iteration
          updateChat(id, () => ({ messages: [...conversation, { role: Role.Assistant, content: '' }] }));
          
          const assistantMessage = await client.complete(
            model!.id,
            chatInstructions,
            conversation,
            chatTools,
            (_, snapshot) => {
              // Use the conversation state instead of fetching from chats to avoid stale closure
              updateChat(id, () => ({ messages: [...conversation, { role: Role.Assistant, content: snapshot }] }))
            }
          );
          
          // Add the assistant message to conversation
          conversation = [...conversation, {
            role: Role.Assistant,
            content: assistantMessage.content ?? "",
            toolCalls: assistantMessage.toolCalls,
          }];

          // Update UI with the assistant message
          updateChat(id, () => ({ messages: conversation }));

          // Check if there are tool calls to handle
          const toolCalls = assistantMessage.toolCalls;
          
          if (!toolCalls || toolCalls.length === 0) {
            // No tool calls, we're done
            break;
          }

          // Handle each tool call
          for (const toolCall of toolCalls) {
            const tool = chatTools.find((t) => t.name === toolCall.name);

            if (!tool) {
              // Tool not found - add error message
              conversation = [...conversation, {
                role: Role.Tool,
                content: '',
                error: {
                  code: 'TOOL_NOT_FOUND',
                  message: `Tool "${toolCall.name}" is not available or not executable.`
                },
                toolResult: {
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  data: `Error: Tool "${toolCall.name}" not found or not executable.`
                },
              }];

              continue;
            }

            try {
              const args = JSON.parse(toolCall.arguments || "{}");
              let content = await tool.function(args, toolContext);

              const data = content;
              const attachments = parseResource(data);

              if (attachments) {
                content = JSON.stringify({
                  successful: true
                });
              }

              if (!content) {
                content = 'No result returned';
              }
              
              // Add tool result to conversation
              conversation = [...conversation, {
                role: Role.Tool,
                content: content,
                attachments,
                toolResult: {
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  data: data,
                },
              }];
            }
            catch (error) {
              console.error("Tool failed", error);

              // Add tool error to conversation
              conversation = [...conversation, {
                role: Role.Tool,
                content: '',
                error: {
                  code: 'TOOL_EXECUTION_ERROR',
                  message: 'The tool could not complete the requested action. Please try again or use a different approach.'
                },
                toolResult: {
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                  data: "error: tool execution failed."
                },
              }];
            }
          }

          // Update conversation with tool results before next iteration
          updateChat(id, () => ({ messages: conversation }));
        }

        setIsResponding(false);

        if (!chatObj.title || conversation.length % 3 === 0) {
          client
            .summarize(model!.id, conversation)
            .then(title => updateChat(id, () => ({ title })));
        }
      } catch (error) {
        console.error(error);
        setIsResponding(false);

        if (error?.toString().includes('missing finish_reason')) return;

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
          content: '',
          error: {
            code: errorCode,
            message: errorMessage
          }
        }];

        updateChat(id, () => ({ messages: conversation }));
      }
    }, [getOrCreateChat, chats, updateChat, chatTools, chatInstructions, client, model, setIsResponding]);

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,

    // Chats
    chats,
    chat,
    messages,
    isResponding,

    // Chat actions
    createChat,
    selectChat,
    deleteChat,
    updateChat,

    // Message actions
    addMessage,
    sendMessage,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
