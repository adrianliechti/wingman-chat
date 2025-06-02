import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Message, Model, Role } from "../models/chat";
import { useChats } from "../hooks/useChats";
import { useModels } from "../hooks/useModels";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { Sidebar } from "../components/Sidebar";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { Button } from "@headlessui/react";
import { Menu as MenuIcon, Plus as PlusIcon } from "lucide-react";
import { getConfig } from "../config";

export function ChatPage() {
  const config = getConfig();
  const client = config.client;
  const bridge = config.bridge;

  const { chats, createChat, updateChat, deleteChat } = useChats();
  const { models } = useModels();

  const [showSidebar, setShowSidebar] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<Model>();

  const currentChat = chats.find(c => c.id === currentChatId) ?? null;
  const messages = currentChat?.messages ?? [];

  const { containerRef, bottomRef, handleScroll, enableAutoScroll } = useAutoScroll({
    dependencies: [messages],
  });

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const onCreateChat = () => {
    setCurrentChatId(null);
  };

  const onSelectChat = (chatId: string) => {
    setCurrentChatId(chatId);
    setShowSidebar(false);
  };

  const onDeleteChat = (chatId: string) => {
    deleteChat(chatId);

    if (currentChat?.id === chatId) {
      onCreateChat();
    }
  };

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
    updateMessages([...base, { role: Role.Assistant, model: model.id, content: "" }]);

    try {
      const tools = await bridge.listTools();

      const completion = await client.complete(
        model.id,
        tools,
        base,
        (_, snapshot) => updateMessages([...base, { role: Role.Assistant, model: model.id, content: snapshot }])
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
        model: model.id, 
        content: `An error occurred:\n${error}`,
      };

      updateMessages([...base, errorMessage]);
    }
  };

  useEffect(() => {
    if (models.length === 0) return;
    const next = currentChat?.model ?? models[0];
    setCurrentModel(next);
  }, [currentChat, models]);

  useEffect(() => {
    if (chats.length == 0) {
      setShowSidebar(false);
    }
  }, [chats]);

  const leftControlsContainer = document.getElementById('chat-left-controls');
  const rightControlsContainer = document.getElementById('chat-right-controls');

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {leftControlsContainer && createPortal(
        <div className="flex items-center gap-2">
          <Button
            className="menu-button"
            onClick={toggleSidebar}
          >
            <MenuIcon size={20} />
          </Button>
        </div>,
        leftControlsContainer
      )}

      {rightControlsContainer && createPortal(
        <Button
          className="menu-button"
          onClick={onCreateChat}
        >
          <PlusIcon size={20} />
        </Button>,
        rightControlsContainer
      )}

      <aside
        className={`${showSidebar ? "translate-x-0" : "-translate-x-full"} transition-all duration-300 fixed top-0 bottom-0 left-0 w-64 z-50`}
        style={{ zIndex: 60 }}
      >
        <Sidebar
          chats={chats}
          selectedChatId={currentChatId}
          onSelectChat={onSelectChat}
          onDeleteChat={onDeleteChat}
        />
      </aside>

      <main
        className="flex-1 flex flex-col overflow-hidden"
        style={{
          paddingBottom: `calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))`
        }}
      >
        {showSidebar && (
          <div
            className="fixed inset-0 z-50 bg-black/10 dark:bg-black/50 backdrop-blur-xs cursor-pointer"
            style={{ zIndex: 55 }}
            onClick={toggleSidebar}
          />
        )}

        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center text-center">
              <img src="/logo.svg" className="w-32 h-32 dark:opacity-80" alt="Wingman Chat" />
            </div>
          </div>
        ) : (
          <div
            className="flex-1 overflow-auto ios-scroll"
            ref={containerRef}
            onScroll={handleScroll}
          >
            <div className="max-content-width px-2 pt-4">
              {messages.map((message, idx) => (
                <ChatMessage 
                  key={idx} 
                  message={message} 
                  onSendMessage={sendMessage}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-20 bg-neutral-50 dark:bg-neutral-950 pb-4 px-3 pb-safe-bottom pl-safe-left pr-safe-right">
        <div className="max-content-width">
          <ChatInput 
            onSend={sendMessage} 
            models={models}
            currentModel={currentModel}
            onModelChange={onSelectModel}
          />
        </div>
      </footer>
    </div>
  );
}

export default ChatPage;
