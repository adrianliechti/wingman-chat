import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus as PlusIcon, Maximize2, Minimize2, Mic, X } from "lucide-react";
import { Button } from "@headlessui/react";
import { Message, Model, Role } from "../models/chat";
import { useModels } from "../hooks/useModels";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { useChats } from "../hooks/useChats";
import { useSidebar } from "../contexts/SidebarContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useResponsiveness } from "../hooks/useResponsiveness";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { ChatSidebar } from "../components/ChatSidebar";
import { getConfig } from "../config";
import { useRealtimeVoice } from '../hooks/useRealtimeVoice';

export function ChatPage() {
  const config = getConfig();
  const client = config.client;
  const bridge = config.bridge;

  const { models } = useModels();
  const [currentModel, setCurrentModel] = useState<Model>();
  const { isResponsive, toggleResponsiveness } = useResponsiveness();

  // Chat state management
  const { chats, createChat, updateChat, deleteChat } = useChats();
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  // Sidebar integration (now only controls visibility)
  const { setShowSidebar, setSidebarContent } = useSidebar();
  const { setRightActions } = useNavigation();

  const currentChat = chats.find(c => c.id === currentChatId) ?? null;
  const messages = currentChat?.messages ?? [];

  const { containerRef, bottomRef, handleScroll, enableAutoScroll } = useAutoScroll({
    dependencies: [currentChat, messages],
  });

  // Use refs to maintain stable references for frequently changing values
  const chatsRef = useRef(chats);
  const currentChatIdRef = useRef(currentChatId);

  // Update refs when values change
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  // Handler functions with stable references
  const onCreateChat = useCallback(() => {
    setCurrentChatId(null);
  }, []);

  const onSelectChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId);
    // Don't auto-close sidebar on larger screens, but close on mobile
    if (window.innerWidth < 768) {
      setShowSidebar(false);
    }
  }, [setShowSidebar]);

  const onDeleteChat = useCallback((chatId: string) => {
    deleteChat(chatId);
    if (chatsRef.current.find(c => c.id === currentChatIdRef.current)?.id === chatId) {
      setCurrentChatId(null);
    }
  }, [deleteChat]); // Now only depends on deleteChat, not chats or currentChatId

  // Set up navigation actions (only once on mount)
  useEffect(() => {
    setRightActions(
      <Button
        className="menu-button"
        onClick={onCreateChat}
      >
        <PlusIcon size={20} />
      </Button>
    );

    // Cleanup when component unmounts
    return () => {
      setRightActions(null);
    };
  }, [setRightActions, onCreateChat]);

  // Create sidebar content with useMemo to avoid infinite re-renders
  const sidebarContent = useMemo(() => (
    <ChatSidebar
      chats={chats}
      selectedChatId={currentChatId}
      onSelectChat={onSelectChat}
      onDeleteChat={onDeleteChat}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [chats, currentChatId]); // Intentionally not including callbacks to prevent infinite loops

  // Set up sidebar content when it changes
  useEffect(() => {
    setSidebarContent(sidebarContent);
    return () => setSidebarContent(null);
  }, [sidebarContent, setSidebarContent]);

  const onSelectModel = (model: Model) => {
    setCurrentModel(model);
    if (currentChat) {
      updateChat(currentChat.id, { model });
    }
  };

  const sendMessage = async (message: Message) => {
    // Re-enable auto-scroll when user sends a message
    enableAutoScroll();

    let chat = currentChat;
    const model = currentModel;

    if (!model) throw new Error("no model selected");

    if (!chat) {
      chat = createChat();
      chat.model = model;
      setCurrentChatId(chat.id);
    }

    const base = [...chat.messages, message];
    const updateMessages = (msgs: typeof base) => updateChat(chat.id, { messages: msgs });
    updateMessages([...base, { role: Role.Assistant, content: "" }]);

    try {
      const tools = await bridge.listTools();

      const completion = await client.complete(
        model.id,
        tools,
        base,
        (_, snapshot) => updateMessages([...base, { role: Role.Assistant, content: snapshot }])
      );

      updateMessages([...base, completion]);

      if (!chat.title || base.length % 3 === 0) {
        client
          .summarize(model.id, base)
          .then((title) => updateChat(chat.id, { title }));
      }
    } catch (error) {
      console.error(error);

      if (error?.toString().includes("missing finish_reason")) return;

      const errorMessage = {
        role: Role.Assistant,
        content: `An error occurred:\n${error}`,
      };
      updateMessages([...base, errorMessage]);
    }
  };

  // Voice input functionality
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const { start: startVoice, stop: stopVoice } = useRealtimeVoice(
    // onUser callback - create user message
    (transcript) => {
      if (transcript.trim()) {
        let chatId = currentChatIdRef.current;
        if (!chatId) {
          const newChat = createChat();
          if (currentModel) newChat.model = currentModel;
          chatId = newChat.id;
          setCurrentChatId(chatId);
        }
        // Append the new user message
        const existing = chatsRef.current.find(c => c.id === chatId)?.messages || [];
        updateChat(chatId, { messages: [...existing, { role: Role.User, content: transcript }] });
        enableAutoScroll();
      }
    },
    // onAssistant callback - create assistant message
    (transcript) => {
      if (transcript.trim()) {
        let chatId = currentChatIdRef.current;
        if (!chatId) {
          const newChat = createChat();
          if (currentModel) newChat.model = currentModel;
          chatId = newChat.id;
          setCurrentChatId(chatId);
        }
        // Append the new assistant message
        const existingA = chatsRef.current.find(c => c.id === chatId)?.messages || [];
        updateChat(chatId, { messages: [...existingA, { role: Role.Assistant, content: transcript }] });
        enableAutoScroll();
      }
    }
  );

  const handleVoiceToggle = async () => {
    try {
      if (isVoiceActive) {
        // Stop voice session
        setIsVoiceActive(false);
        await stopVoice();
      } else {
        // Start voice session
        setIsVoiceActive(true);
        await startVoice();
      }
    } catch (error) {
      console.error('Voice toggle error:', error);
      setIsVoiceActive(false);
    }
  };

  useEffect(() => {
    if (models.length === 0) return;
    const next = currentChat?.model ?? models[0];
    setCurrentModel(next);
  }, [currentChat, models]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">

      {/* Action buttons - positioned at page level */}
      <div className="hidden md:flex absolute top-4 right-4 z-20 gap-2">
        <Button
          onClick={handleVoiceToggle}
          className={`menu-button !p-1.5 ${isVoiceActive ? 'bg-red-500 hover:bg-red-600 text-white' : ''}`}
          title={isVoiceActive ? "Stop voice session" : "Start voice session"}
        >
          {isVoiceActive ? <X size={14} /> : <Mic size={14} />}
        </Button>
        <Button
          onClick={toggleResponsiveness}
          className="menu-button !p-1.5"
          title={isResponsive ? "Switch to fixed width (900px)" : "Switch to responsive mode (80%/80%)"}
        >
          {isResponsive ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>
      </div>
      <main className="flex-1 flex flex-col overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center text-center">
              <img src="/logo.svg" className="w-32 h-32 dark:opacity-80" alt="Wingman Chat" />
            </div>
          </div>
        ) : (
          <div
            className="flex-1 overflow-auto ios-scroll sidebar-scroll"
            ref={containerRef}
            onScroll={handleScroll}
          >
            <div className={`px-2 pt-4 ${isResponsive
              ? 'max-w-[80vw] mx-auto'
              : 'max-content-width'
              }`}>
              {messages.map((message, idx) => (
                <ChatMessage key={idx} message={message} />
              ))}
              {/* sentinel for scrollIntoView */}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </main>


      <footer className="bg-neutral-50 dark:bg-neutral-950 pb-4 px-3 pb-safe-bottom pl-safe-left pr-safe-right">
        <div className={isResponsive ? 'max-w-[80vw] mx-auto' : 'max-content-width'}>
          {!isVoiceActive && (<ChatInput
            onSend={sendMessage}
            models={models}
            currentModel={currentModel}
            onModelChange={onSelectModel}
          />
          )}
        </div>
      </footer>

    </div>
  );
}

export default ChatPage;