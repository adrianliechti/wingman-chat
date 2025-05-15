import { useState } from "react";
import { ChatPage } from "./pages/ChatPage";
import { TranslatePage } from "./pages/TranslatePage";

type Page = "chat" | "translate";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("chat");

  const pages: { key: Page; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "translate", label: "Translate" },
  ];

  return (
    <div className="h-dvh w-dvw flex flex-col">
      <nav className="p-2 flex justify-center bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-700">
        <div className="flex space-x-2">
          {pages.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCurrentPage(key)}
              className={`px-4 p-2 text-sm font-medium rounded transition-colors ${
                currentPage === key
                  ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-200"
                  : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-grow overflow-auto">
        {currentPage === "chat" && <ChatPage />}
        {currentPage === "translate" && <TranslatePage />}
      </div>
    </div>
  );
}

export default App;
