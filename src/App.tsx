import { useEffect, useRef, useState } from "react";

import { complete, summarize } from "./lib/client";
import { Chat, Message, Model, Role } from "./models/chat";

import { useChats } from "./hooks/useChats";
import { useModels } from "./hooks/useModels";

import { SquarePen } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { ChatMessage } from "./components/ChatMessage";
import { ChatSidebar } from "./components/ChatSidebar";
import { ModelSelector } from "./components/ModelSelector";
import { ThemeToggle } from "./components/ThemeToggle";
import { Button } from "./components/ui/Button";
import { SidebarInset, SidebarTrigger } from "./components/ui/Sidebar";

function App() {
  const { chats, createChat, deleteChat, saveChats } = useChats();
  const { models } = useModels();

  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [currentModel, setCurrentModel] = useState<Model>();
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);

  const messageContainerRef = useRef<HTMLDivElement>(null);

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

      const content =
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
    messageContainerRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentChat, currentMessages]);

  return (
    <>
      <ChatSidebar
        chats={chats}
        selectedChat={currentChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={(chat) => handleDeleteChat(chat.id)}
      />

      <SidebarInset>
        {/* <main className="flex flex-col h-full"> */}
        <header className="sticky top-0 flex items-center gap-2 pl-2 bg-background h-14 shrink-0">
          <div className="flex items-center flex-1 gap-2 px-3">
            <div>
              <SidebarTrigger variant={"outline"} className="p-4" />
            </div>

            <div>
              <ModelSelector
                models={models}
                onSelectModel={(model) => setCurrentModel(model)}
                currentModel={currentModel}
              />
            </div>

            <div className="flex gap-2 px-3 ml-auto">
              <ThemeToggle />
              <Button
                className="rounded hover:text-gray-300"
                onClick={handleCreateChat}
                variant="outline"
                size={"icon"}
              >
                <SquarePen size={20} />
              </Button>
            </div>
          </div>
        </header>
        <main className="flex flex-col items-center justify-center w-full mx-auto">
          <div
            className="flex-1 w-full p-4 pb-24 overflow-auto md:max-w-4xl"
            ref={messageContainerRef}
          >
            {currentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full pt-56 text-[#e5e5e5]">
                <img src="/logo.png" className="w-48 h-48 mb-4" />
              </div>
            ) : (
              currentMessages.map((message, idx) => (
                <ChatMessage key={idx} message={message} />
              ))
            )}
          </div>
          <div ref={messageContainerRef} />

          <footer className="fixed bottom-2 border-tp-4">
            <ChatInput onSend={sendMessage} />
          </footer>
        </main>
      </SidebarInset>
    </>
  );
}

export default App;
