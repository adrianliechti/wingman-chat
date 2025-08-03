import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Message, Model, Tool, Role } from "../types/chat";
import { useModels } from "../hooks/useModels";
import { useChats } from "../hooks/useChats";
import { useRepositories } from "../hooks/useRepositories";
import { useRepository } from "../hooks/useRepository";
import { useArtifacts } from "../hooks/useArtifacts";
import { useBridge } from "../hooks/useBridge";
import { useProfile } from "../hooks/useProfile";
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
  const { currentRepository } = useRepositories();
  const { artifactsTools } = useArtifacts();
  const { queryTools, queryInstructions } = useRepository(currentRepository?.id || '');
  const { bridgeTools, bridgeInstructions } = useBridge();
  const { generateInstructions } = useProfile();
  const [chatId, setChatId] = useState<string | null>(null);
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
    return newChat;
  }, [createChatHook]);

  const selectChat = useCallback((chatId: string) => {
    setChatId(chatId);
  }, []);

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
      updateChat(chat.id, { model });
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
      updateChat(chatItem.id, { model });

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
      updateChat(id, { messages: updatedMessages });
    },
    [getOrCreateChat, updateChat]
  );

  const sendMessage = useCallback(
    async (message: Message, tools?: Tool[]) => {
      const { id, chat: chatObj } = getOrCreateChat();

      const existingMessages = chats.find(c => c.id === id)?.messages || [];
      const conversation = [...existingMessages, message];

      updateChat(id, { messages: [...conversation, { role: Role.Assistant, content: '' }] });

      try {
        const profileInstructions = generateInstructions();
        
        const repositoryTools = currentRepository ? queryTools() : [];
        const repositoryInstructions = queryInstructions();
        
        const completionTools = [...bridgeTools, ...repositoryTools, ...artifactsTools(), ...(tools || [])];

        const instructions: string[] = [];

        if (profileInstructions.trim()) {
          instructions.push(profileInstructions);
        }

        if (repositoryInstructions.trim()) {
          instructions.push(repositoryInstructions);
        }

        if (bridgeInstructions?.trim()) {
          instructions.push(bridgeInstructions);
        }
        
        const completion = await client.complete(
          model!.id,
          instructions.join('\n\n'),
          conversation,
          completionTools,
          (_, snapshot) => updateChat(id, { messages: [...conversation, { role: Role.Assistant, content: snapshot }] })
        );

        updateChat(id, { messages: [...conversation, completion] });

        if (!chatObj.title || conversation.length % 3 === 0) {
          client
            .summarize(model!.id, conversation)
            .then(title => updateChat(id, { title }));
        }
      } catch (error) {
        console.error(error);

        if (error?.toString().includes('missing finish_reason')) return;

        const errorMessage = { role: Role.Assistant, content: `An error occurred:\n${error}` };
        updateChat(id, { messages: [...conversation, errorMessage] });
      }
    }, [getOrCreateChat, chats, updateChat, generateInstructions, currentRepository, queryTools, queryInstructions, bridgeTools, artifactsTools, bridgeInstructions, client, model]);

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
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
