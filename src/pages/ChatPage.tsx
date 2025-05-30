import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Chat, Message, Model, Role } from "../models/chat";
import { useChats } from "../hooks/useChats";
import { useModels } from "../hooks/useModels";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { Sidebar } from "../components/Sidebar";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { URLPanel } from "../components/URLPanel";
import { Button } from "@headlessui/react";
import { Menu as MenuIcon, Plus as PlusIcon } from "lucide-react";
import { getConfig } from "../config";

export function ChatPage() {
  const config = getConfig();
  const client = config.client;
  const bridge = config.bridge;

  const { chats, createChat, deleteChat, saveChats } = useChats();
  const { models } = useModels();

  const [showSidebar, setShowSidebar] = useState(false);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [currentModel, setCurrentModel] = useState<Model>();
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [selectedURL, setSelectedURL] = useState<string | null>(null);
  
  const { containerRef: messageContainerRef, handleScroll } = useAutoScroll({
    dependencies: [currentChat, currentMessages],
  });

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleCreateChat = () => {
    setCurrentChat(null);
  };

  const handleURLClick = (url: string) => {
    setSelectedURL(url);
  };

  const handleCloseURLPanel = () => {
    setSelectedURL(null);
  };

  const handleDeleteChat = (id: string) => {
    deleteChat(id);
    if (currentChat?.id === id) {
      handleCreateChat();
    }
  };

  const handleSelectChat = (chat: Chat) => {
    setCurrentChat(chat);
  };

  const sendMessage = async (message: Message) => {
    let chat = currentChat;
    const model = currentModel;

    if (!model) {
      throw new Error("no model selected");
    }

    if (!chat) {
      chat = createChat();
      chat.model = model;
      setCurrentChat(chat);
    }

    let messages = [...currentMessages, message];

    setCurrentMessages([
      ...messages,
      {
        role: Role.Assistant,
        content: "",
      },
    ]);

    try {
      const tools = await bridge.listTools();

      const completion = await client.complete(model.id, tools, messages, (_, snapshot) => {
        setCurrentMessages([
          ...messages,
          {
            role: Role.Assistant,
            content: snapshot,
          },
        ]);
      });

      messages = [...messages, completion];
      setCurrentMessages(messages);

      if (!chat.title || messages.length % 3 === 0) {
        client.summarize(model.id, messages).then((title) => {
          chat!.title = title;
        });
      }
    } catch (error) {
      console.log(error);

      if (error?.toString().includes("missing finish_reason")) {
        return;
      }

      const content = "An error occurred while processing the request.\n" + error?.toString();

      setCurrentMessages([
        ...messages,
        {
          role: Role.Assistant,
          content: content,
        },
      ]);
    }
  };

  useEffect(() => {
    if (currentModel) {
      return;
    }
    if (models.length > 0) {
      setCurrentModel(models[0]);
    }
  }, [currentModel, models]);

  useEffect(() => {
    if (chats.length == 0) {
      setShowSidebar(false);
    }
  }, [chats]);

  useEffect(() => {
    if (currentChat) {
      currentChat.updated = new Date();
      currentChat.model = currentModel ?? null;
    }
  }, [currentChat, currentModel]);

  useEffect(() => {
    if (!currentChat) {
      return;
    }
    currentChat.updated = new Date();
    currentChat.messages = currentMessages;
    saveChats();
  }, [currentChat, currentMessages, saveChats]);

  useEffect(() => {
    setCurrentModel(currentChat?.model ?? currentModel);
    setCurrentMessages(currentChat?.messages ?? []);
  }, [currentChat, currentModel]);

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
          onClick={handleCreateChat}
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
          isVisible={showSidebar}
          chats={chats}
          selectedChat={currentChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={(chat) => handleDeleteChat(chat.id)}
        />
      </aside>

      <main 
        className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${selectedURL ? 'md:mr-96' : ''}`}
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

        {selectedURL && (
          <div
            className="fixed inset-0 z-40 bg-black/10 dark:bg-black/50 backdrop-blur-xs cursor-pointer md:hidden"
            style={{ zIndex: 45 }}
            onClick={handleCloseURLPanel}
          />
        )}

        <div
          className="flex-1 overflow-auto px-2 pt-4 pb-0 ios-scroll"
          ref={messageContainerRef}
          onScroll={handleScroll}
        >
          {currentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-full text-center">
              <img src="/logo.svg" className="w-48 h-48 mb-4" />
            </div>
          ) : (
            currentMessages.map((message, idx) => (
              <ChatMessage key={idx} message={message} onURLClick={handleURLClick} />
            ))
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-20 bg-neutral-50 dark:bg-neutral-950 pb-4 px-3 pb-safe-bottom pl-safe-left pr-safe-right">
        <ChatInput 
          onSend={sendMessage} 
          models={models}
          currentModel={currentModel}
          onModelChange={setCurrentModel}
        />
      </footer>

      <URLPanel url={selectedURL} onClose={handleCloseURLPanel} />
    </div>
  );
}

export default ChatPage;
