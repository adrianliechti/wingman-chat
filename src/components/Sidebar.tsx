import { Trash } from "lucide-react";
import { getConfig } from "../config";
import { Chat } from "../models/chat";

type SidebarProps = {
  isVisible: boolean;

  chats: Chat[];
  selectedChat: Chat | null;

  onSelectChat: (chat: Chat) => void;
  onDeleteChat: (chat: Chat) => void;
};

export function Sidebar({
  isVisible,
  chats,
  selectedChat,
  onSelectChat,
  onDeleteChat,
}: SidebarProps) {
  const config = getConfig();

  return (
    <div
      className={`fixed top-0 left-0 h-full w-64 transition-transform duration-300 ${
        isVisible ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex flex-col h-full gap-4 p-4">
        <h2 className="text-xl font-semibold">{config.title}</h2>
        <ul className="flex flex-col flex-1 gap-2 overflow-auto">
          {chats.map((chat) => (
            <li
              key={chat.id}
              className={`p-2 rounded flex items-center justify-between cursor-pointer ${
                chat.id === selectedChat?.id ? "bg-primary" : ""
              }`}
            >
              <div
                onClick={() => onSelectChat(chat)}
                className="flex-1 overflow-hidden whitespace-nowrap"
                title={chat.title ?? "Untitled"}
              >
                {chat.title ?? "Untitled"}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat);
                }}
                className="text-[#e5e5e5] hover:text-gray-300 p-1"
              >
                <Trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
