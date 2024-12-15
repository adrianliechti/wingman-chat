import { Trash } from 'lucide-react';
import { Chat } from '../models/chat';
import { Title } from '../lib/config';

type SidebarProps = {
  isVisible: boolean;

  chats: Chat[];
  selectedChat: Chat | null;
    
  onSelectChat: (chat: Chat) => void;
  onDeleteChat: (chat: Chat) => void;
};

export function Sidebar({ isVisible, chats, selectedChat, onSelectChat, onDeleteChat }: SidebarProps) {
  return (
    <div
      className={`fixed top-0 left-0 h-full w-64 bg-[#1c1c1e] text-[#e5e5e5] transition-transform duration-300 ${isVisible ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="flex flex-col h-full gap-4 p-4">
        <h2 className="text-xl font-semibold">{Title}</h2>
        <ul className="flex flex-col gap-2 flex-1 overflow-auto">
          {chats.map((chat) => (
            <li
              key={chat.id}
              className={`p-2 rounded flex items-center justify-between cursor-pointer hover:bg-[#2c2c2e] ${chat.id === selectedChat?.id ? 'bg-[#3a3a3c]' : ''
                }`}
            >
              <div
                onClick={() => onSelectChat(chat)}
                className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {chat.title ?? chat.id ?? 'Untitled'}
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