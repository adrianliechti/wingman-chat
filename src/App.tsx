import { useState } from "react";
import { MessageCircle, Languages } from "lucide-react";
import { Button } from "@headlessui/react";
import { ChatPage } from "./pages/ChatPage";
import { TranslatePage } from "./pages/TranslatePage";

type Page = "chat" | "translate";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("chat");

  const pages: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: "chat", label: "Chat", icon: <MessageCircle size={20} /> },
    { key: "translate", label: "Translate", icon: <Languages size={20} /> },
  ];

  return (
    <div className="h-dvh w-dvw flex flex-col overflow-hidden">
      <nav className="fixed top-0 left-0 right-0 z-50 px-3 py-2 pl-safe-left pr-safe-right pt-safe-top bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-200/60 dark:border-neutral-700/60 shadow-sm shadow-black/10 dark:shadow-black/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 w-1/3">
            {currentPage === "chat" && <div id="chat-left-controls"></div>}
            {currentPage === "translate" && <div id="translate-left-controls"></div>}
          </div>
          
          <div className="flex space-x-1 sm:space-x-2">
            {pages.map(({ key, label, icon }) => (
              <Button
                key={key}
                onClick={() => setCurrentPage(key)}
                className={`px-2 py-2 sm:px-4 font-medium rounded transition-colors flex items-center justify-center gap-1 sm:gap-2 cursor-pointer ${
                  currentPage === key
                    ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-200"
                    : "bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
          </div>
          
          <div className="flex items-center gap-2 w-1/3 justify-end">
            {currentPage === "chat" && <div id="chat-right-controls"></div>}
            {currentPage === "translate" && <div id="translate-right-controls"></div>}
          </div>
        </div>
      </nav>
      <div className="flex-grow overflow-hidden" style={{ paddingTop: `calc(3rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))` }}>
        <div className="h-full">
          {currentPage === "chat" && <ChatPage />}
          {currentPage === "translate" && <TranslatePage />}
        </div>
      </div>
    </div>
  );
}

export default App;
