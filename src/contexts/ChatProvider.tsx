import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Message, Model, Role } from "../types/chat";
import { useModels } from "../hooks/useModels";
import { useChats } from "../hooks/useChats";
import { useChatContext } from "../hooks/useChatContext";
import { useSearch } from "../hooks/useSearch";
import { getConfig } from "../config";
import { ChatContext, ChatContextType } from './ChatContext';

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const config = getConfig();
  const client = config.client;

  const { models, selectedModel, setSelectedModel } = useModels();
  const { chats, createChat: createChatHook, updateChat, deleteChat: deleteChatHook } = useChats();
  const { tools: chatTools, instructions: chatInstructions } = useChatContext();
  const { setEnabled: setSearchEnabled } = useSearch();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const messagesRef = useRef<Message[]>([]);

  const chat = chats.find(c => c.id === chatId) ?? null;
  const model = chat?.model ?? selectedModel ?? models[0];
  const messages = useMemo(() => {
    const msgs = chat?.messages ?? [];
    messagesRef.current = msgs;
    return msgs;
  }, [chat?.messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

      const existingMessages = chats.find(c => c.id === id)?.messages || [];
      const conversation = [...existingMessages, message];

      updateChat(id, () => ({ messages: [...conversation, { role: Role.Assistant, content: '' }] }));
      setIsResponding(true);

      try {
        const completion = await client.complete(
          model!.id,
          chatInstructions,
          conversation,
          chatTools,
          (_, snapshot) => updateChat(id, () => ({ messages: [...conversation, { role: Role.Assistant, content: snapshot }] }))
        );

        updateChat(id, () => ({ messages: [...conversation, completion] }));
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

        const errorMessage = { role: Role.Assistant, content: `An error occurred:\n${error}` };
        updateChat(id, () => ({ messages: [...conversation, errorMessage] }));
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
