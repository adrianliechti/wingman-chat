import { useState, useEffect, useRef } from "react";

import { Chat, Message, Model, Role } from "./models/chat";
import { complete, summarize } from "./lib/client";

import { useChats } from "./hooks/useChats";
import { useModels } from "./hooks/useModels";

import { Sidebar } from "./components/Sidebar";

import { ChatInput } from "./components/ChatInput";
import { ChatMessage } from "./components/ChatMessage";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";

import { Menu as MenuIcon, Plus as PlusIcon } from "lucide-react";

function App() {
  const { chats, createChat, deleteChat, saveChats } = useChats();
  const { models } = useModels();

  const [showSidebar, setShowSidebar] = useState(false);

  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [currentModel, setCurrentModel] = useState<Model>();
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);

  const messageContainerRef = useRef<HTMLDivElement>(null);

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleCreateChat = () => {
    setCurrentChat(null);
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
    var chat = currentChat;
    var model = currentModel;

    if (!model) {
      throw new Error("no model selected");
    }

    if (!chat) {
      chat = createChat();
      chat.model = model;

      setCurrentChat(chat);
    }

    var messages = [...currentMessages, message];

    setCurrentMessages([
      ...messages,
      {
        role: Role.Assistant,
        content: "...",
      },
    ]);

    try {
      const completion = await complete(model.id, messages, (_, snapshot) => {
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

      if (messages.length % 4 === 0) {
        summarize(model.id, messages).then((title) => {
          chat!.title = title;
        });
      }

    } catch (error) {
      if (error?.toString().includes("missing finish_reason")) {
        console.log(error);
        return;
      }

      var content =
        "An error occurred while processing the request.\n" + error?.toString();

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
  }, [models]);

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
  }, [currentModel]);

  useEffect(() => {
    if (!currentChat) {
      return;
    }

    currentChat.updated = new Date();
    currentChat.messages = currentMessages;

    saveChats();
  }, [currentMessages]);

  useEffect(() => {
    setCurrentModel(currentChat?.model ?? currentModel);
    setCurrentMessages(currentChat?.messages ?? []);
  }, [currentChat]);

  useEffect(() => {
    messageContainerRef.current?.scrollTo({
      top: messageContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [currentChat, currentMessages]);

  return (
    <div className="h-dvh w-dvw overflow-hidden bg-[#121212]">
      <aside
        className={`${showSidebar ? "translate-x-0" : "-translate-x-full"}
        bg-[#1c1c1e] text-[#e5e5e5] transition-all duration-300 fixed top-0 bottom-0 left-0 w-64 z-30`}
      >
        <Sidebar
          isVisible={showSidebar}
          chats={chats}
          selectedChat={currentChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={(chat) => handleDeleteChat(chat.id)}
        />
      </aside>

      <main className="h-full flex flex-col">
        {showSidebar && (
          <div
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-xs"
            onClick={toggleSidebar}
          />
        )}

        <header
          className={`fixed top-2 left-2 bg-[#121212] flex transition-transform duration-300 ${
            showSidebar ? "translate-x-64" : "translate-x-0"
          }`}
        >
          <div className="flex gap-2">
            <Button
              className="p-2 text-[#e5e5e5] hover:text-gray-300 bg-[#1c1c1e] rounded"
              onClick={toggleSidebar}
            >
              <MenuIcon size={20} />
            </Button>

            {/* <div className="hidden sm:block"> */}
            <div>
              <Menu>
                <MenuButton className="inline-flex items-center p-2 text-[#e5e5e5] bg-[#1c1c1e] rounded">
                  {currentModel?.name ?? currentModel?.id ?? "Select Model"}
                </MenuButton>

                <MenuItems
                  transition
                  anchor="bottom start"
                  className="!max-h-[50vh] mt-2 rounded border bg-[#1c1c1e] border-[#3a3a3c] overflow-y-auto shadow-lg"
                >
                  {models.map((model) => (
                    <MenuItem key={model.id}>
                      <Button
                        onClick={() => setCurrentModel(model)}
                        className="group flex w-full items-center px-4 py-2 text-[#e5e5e5] data-[focus]:bg-[#2c2c2e] cursor-pointer"
                      >
                        {model.name ?? model.id}
                      </Button>
                    </MenuItem>
                  ))}
                </MenuItems>
              </Menu>
            </div>
          </div>
        </header>

        <header className="fixed top-2 right-2 z-10">
          <Button
            className="p-2 text-[#e5e5e5] hover:text-gray-300 bg-[#1c1c1e] rounded"
            onClick={handleCreateChat}
          >
            <PlusIcon size={20} />
          </Button>
        </header>

        <div
          className="flex-1 overflow-auto bg-[#121212] p-4 mt-14"
          ref={messageContainerRef}
        >
          {currentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-[#e5e5e5]">
              <img src="/logo.png" className="w-48 h-48 mb-4" />
            </div>
          ) : (
            currentMessages.map((message, idx) => (
              <ChatMessage key={idx} message={message} />
            ))
          )}
        </div>

        <footer className="bg-[#121212] border-t border-[#3a3a3c] p-4">
          <ChatInput onSend={sendMessage} />
        </footer>
      </main>
    </div>
  );
}

export default App;
