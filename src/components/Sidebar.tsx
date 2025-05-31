import { Trash } from "lucide-react";
import { Button } from "@headlessui/react";
import { Chat } from "../models/chat";
import { getConfig } from "../config";
import { useMemo } from "react";

type SidebarProps = {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
};

export function Sidebar({ chats, selectedChatId, onSelectChat, onDeleteChat }: SidebarProps) {
  const config = getConfig();
  // sort once per chats change
  const sortedChats = useMemo(
    () => [...chats].sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime()),
    [chats]
  );

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-neutral-900">
      <div 
        className="flex items-center px-2 py-2 pt-safe-top"
        style={{ height: `calc(3rem + env(safe-area-inset-top, 0px))` }}
      >
        <h2 className="text-xl font-semibold px-2">{config.title}</h2>
      </div>
      
      <div 
        className="flex flex-col flex-1 overflow-hidden px-2"
        style={{ 
          paddingTop: '0'
        }}
      >
        <ul className="flex flex-col gap-2 flex-1 overflow-auto">
          {sortedChats.map((chat) => (
            <li
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className={`flex items-center justify-between sidebar-item cursor-pointer relative ${
                chat.id === selectedChatId ? "sidebar-item-selected" : ""
              }`}
            >
              <div
                className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap pr-2"
                title={chat.title ?? "Untitled"}
              >
                {chat.title ?? "Untitled"}
              </div>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id);
                }}
                className="opacity-0 hover:opacity-100 transition-opacity duration-200 cursor-pointer shrink-0"
              >
                <Trash size={16} />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
