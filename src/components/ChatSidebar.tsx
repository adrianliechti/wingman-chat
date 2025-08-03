import { Trash, PanelRightOpen, MoreVertical, GitBranch } from "lucide-react";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { getConfig } from "../config";
import { useMemo, useCallback, useState, useEffect } from "react";
import { useChat } from "../hooks/useChat";
import { useSidebar } from "../hooks/useSidebar";

export function ChatSidebar() {
  const config = getConfig();
  const { chats, chat, selectChat, deleteChat, createChat, updateChat } = useChat();
  const { setShowSidebar, showSidebar } = useSidebar();
  const [shouldAnimateItems, setShouldAnimateItems] = useState(false);
  
  // Trigger item animations every time sidebar opens
  useEffect(() => {
    if (showSidebar) {
      // Small delay to ensure sidebar slide animation starts first
      const timer = setTimeout(() => {
        setShouldAnimateItems(true);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setShouldAnimateItems(false);
    }
  }, [showSidebar]);
  
  // sort once per chats change
  const sortedChats = useMemo(
    () => [...chats].sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime()),
    [chats]
  );

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
      className="flex flex-col h-full w-full bg-neutral-100/50 dark:bg-neutral-950/80"
    >
      {/* Static header with title and hamburger menu */}
      <div 
        className="flex items-center justify-between px-2 py-2.5 flex-shrink-0 min-h-14"
      >
        <h2 className="text-xl font-semibold px-2 whitespace-nowrap overflow-hidden text-ellipsis text-neutral-800 dark:text-neutral-200">{config.title}</h2>
        <Button
          onClick={() => setShowSidebar(false)}
          className="p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/30 dark:hover:bg-black/20 rounded transition-all duration-200 "
          aria-label="Close sidebar"
        >
          <PanelRightOpen size={20} />
        </Button>
      </div>
      
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        <ul className="flex flex-col gap-2 py-2 px-2">
        {sortedChats.map((chatItem, index) => (
          <li
            key={chatItem.id}
            onClick={() => {
              selectChat(chatItem.id);
              // Close sidebar on mobile when chat is selected
              if (window.innerWidth < 768) {
                setShowSidebar(false);
              }
            }}
            style={{ '--item-index': index } as React.CSSProperties}
            className={`flex items-center justify-between sidebar-item-base cursor-pointer relative flex-shrink-0 group ${
              chatItem.id === chat?.id ? "sidebar-item-selected" : ""
            } ${shouldAnimateItems ? "sidebar-item-animate" : "sidebar-item-hidden"}`}
          >
            <div
              className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 dark:text-neutral-200"
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
                transition
                anchor="bottom end"
                className="w-32 origin-top-right rounded-md border border-white/20 dark:border-white/15 bg-white/90 dark:bg-black/90 backdrop-blur-lg shadow-lg transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] data-[closed]:scale-95 data-[closed]:opacity-0 z-50"
              >
                <MenuItem>
                  <Button
                    onClick={() => forkChat(chatItem)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-[focus]:bg-neutral-500/10 dark:data-[focus]:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 "
                  >
                    <GitBranch size={14} />
                    Fork
                  </Button>
                </MenuItem>
                <MenuItem>
                  <Button
                    onClick={() => deleteChat(chatItem.id)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-[focus]:bg-red-500/10 dark:data-[focus]:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 "
                  >
                    <Trash size={14} />
                    Delete
                  </Button>
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
