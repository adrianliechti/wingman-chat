import { Trash, PanelRightOpen, MoreVertical, GitBranch, Search, X } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useMemo, useCallback, useState } from "react";
import { useChat } from "../hooks/useChat";
import { useSidebar } from "../hooks/useSidebar";

export function ChatSidebar() {
  const { chats, chat, selectChat, deleteChat, createChat, updateChat } = useChat();
  const { setShowSidebar } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  
  // sort once per chats change
  const sortedChats = useMemo(
    () => [...chats].sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime()),
    [chats]
  );

  // Filter chats based on search query
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedChats;
    }
    
    const query = searchQuery.toLowerCase();
    
    return sortedChats.filter((chatItem) => {
      // Search in title
      if (chatItem.title?.toLowerCase().includes(query)) {
        return true;
      }
      
      // Search in message content
      return chatItem.messages.some((message) => 
        message.content?.toLowerCase().includes(query)
      );
    });
  }, [sortedChats, searchQuery]);

  // Function to fork a chat (create a new chat with copied messages)
  const forkChat = useCallback((chatToFork: typeof chats[0]) => {
    const newChat = createChat();
    
    // Copy all the properties from the original chat
    updateChat(newChat.id, () => ({
      title: chatToFork.title ? `${chatToFork.title} (Fork)` : "Forked Chat",
      model: chatToFork.model,
      messages: [...chatToFork.messages], // Create a copy of the messages array
    }));
    
    // The chat is already selected by createChat, but we need to ensure it's visible
    // Use a small delay to ensure state updates have propagated
    requestAnimationFrame(() => {
      // Close sidebar on mobile after forking
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
    });
  }, [createChat, updateChat, setShowSidebar]);

  return (
    <div
      className="flex flex-col h-full w-full bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md"
    >
      {/* Static header with buttons */}
      <div 
        className="flex items-center px-2 py-2 md:px-1 md:py-1 shrink-0 h-14 md:h-10 gap-1"
      >
        {showSearch ? (
          <div className="flex-1 flex items-center gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full min-w-0 px-2 py-0.5 text-sm bg-transparent text-neutral-800 dark:text-neutral-200 placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
              className="p-2 md:p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
              aria-label="Close search"
            >
              <X size={20} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-2 md:gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowSearch(true)}
                className="p-2 md:p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/30 dark:hover:bg-black/20 rounded transition-all duration-200"
                aria-label="Search chats"
              >
                <Search size={20} />
              </button>
              <button
                type="button"
                onClick={() => setShowSidebar(false)}
                className="p-2 md:p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/30 dark:hover:bg-black/20 rounded transition-all duration-200"
                aria-label="Close sidebar"
              >
                <PanelRightOpen size={20} />
              </button>
            </div>
          </>
        )}
      </div>
      
      {/* Scrollable content area */}
      <div className="flex-1 sidebar-scroll overflow-y-auto overflow-x-hidden">
        <ul className="flex flex-col gap-0.5 pt-4 pb-1 px-1">
        {filteredChats.map((chatItem) => (
          <li
            key={chatItem.id}
            onClick={() => {
              selectChat(chatItem.id);
              // Close sidebar on mobile when chat is selected
              if (window.innerWidth < 768) {
                setShowSidebar(false);
              }
            }}
            className={`flex items-center justify-between sidebar-item-base cursor-pointer relative shrink-0 group ${
              chatItem.id === chat?.id ? "sidebar-item-selected" : ""
            }`}
          >
            <div
              className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-neutral-800 dark:text-neutral-200"
              title={chatItem.title ?? "Untitled"}
            >
              {chatItem.title ?? "Untitled"}
            </div>
            <Menu>
              <MenuButton
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200  shrink-0 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 p-0 rounded hover:bg-white/30 dark:hover:bg-black/20"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </MenuButton>
              <MenuItems
                modal={false}
                transition
                anchor="bottom end"
                className="w-32 origin-top-right rounded-md border border-white/20 dark:border-white/15 bg-white/90 dark:bg-black/90 backdrop-blur-lg shadow-lg transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] data-closed:scale-95 data-closed:opacity-0 z-50"
              >
                <MenuItem>
                  <button
                    type="button"
                    onClick={() => forkChat(chatItem)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 "
                  >
                    <GitBranch size={14} />
                    Fork
                  </button>
                </MenuItem>
                <MenuItem>
                  <button
                    type="button"
                    onClick={() => deleteChat(chatItem.id)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 "
                  >
                    <Trash size={14} />
                    Delete
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
