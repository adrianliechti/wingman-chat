import { Trash, PanelRightOpen, MoreVertical, GitBranch, Search, X, Pencil } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { getTextFromContent } from "@/shared/types/chat";

export function ChatSidebar() {
  const { chats, chat, deleteChat, createChat, updateChat } = useChat();
  const { setShowSidebar } = useSidebar();
  const { newChat, openChat } = useChatNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  const startRename = useCallback((chatItem: (typeof chats)[0]) => {
    setRenamingChatId(chatItem.id);
    setRenameValue(chatItem.customTitle ?? chatItem.title ?? "");
  }, []);

  const confirmRename = useCallback(() => {
    if (renamingChatId) {
      const trimmed = renameValue.trim();
      updateChat(renamingChatId, () => ({
        customTitle: trimmed || undefined,
      }));
      setRenamingChatId(null);
    }
  }, [renamingChatId, renameValue, updateChat]);

  const cancelRename = useCallback(() => {
    setRenamingChatId(null);
  }, []);

  // sort once per chats change
  const sortedChats = useMemo(
    () =>
      [...chats].sort(
        (a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime(),
      ),
    [chats],
  );

  // Filter chats based on search query
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedChats;
    }

    const query = searchQuery.toLowerCase();

    return sortedChats.filter((chatItem) => {
      // Search in custom title and auto-generated title
      if (chatItem.customTitle?.toLowerCase().includes(query)) {
        return true;
      }
      if (chatItem.title?.toLowerCase().includes(query)) {
        return true;
      }

      // Search in message content
      return chatItem.messages.some((message) => getTextFromContent(message.content).toLowerCase().includes(query));
    });
  }, [sortedChats, searchQuery]);

  // Helper function to get date category
  const getDateCategory = useCallback((date: Date): string => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const chatDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // Today
    if (chatDate.getTime() === today.getTime()) {
      return "Today";
    }

    // Yesterday
    if (chatDate.getTime() === yesterday.getTime()) {
      return "Yesterday";
    }

    // This week (within last 7 days)
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    if (chatDate > weekAgo) {
      return "This Week";
    }

    // Last week (7-14 days ago)
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    if (chatDate > twoWeeksAgo) {
      return "Last Week";
    }

    // Last month (within 30 days)
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    if (chatDate > monthAgo) {
      return "Last Month";
    }

    // Older
    return "Older";
  }, []);

  // Group chats by date category
  const groupedChats = useMemo(() => {
    const groups: { category: string; chats: typeof filteredChats }[] = [];
    const categoryOrder = ["Today", "Yesterday", "This Week", "Last Week", "Last Month", "Older"];
    const categoryMap = new Map<string, typeof filteredChats>();

    filteredChats.forEach((chatItem) => {
      const date = new Date(chatItem.updated || chatItem.created || 0);
      const category = getDateCategory(date);

      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(chatItem);
    });

    // Build groups in order
    categoryOrder.forEach((category) => {
      const chats = categoryMap.get(category);
      if (chats && chats.length > 0) {
        groups.push({ category, chats });
      }
    });

    return groups;
  }, [filteredChats, getDateCategory]);

  // Flatten grouped chats into a single list for virtualization
  type FlatSidebarItem =
    | { type: "header"; group: (typeof groupedChats)[0]; groupIndex: number }
    | { type: "item"; chat: (typeof chats)[0] };

  const flatSidebarItems = useMemo<FlatSidebarItem[]>(() => {
    const items: FlatSidebarItem[] = [];
    groupedChats.forEach((group, groupIndex) => {
      items.push({ type: "header", group, groupIndex });
      group.chats.forEach((chatItem) => {
        items.push({ type: "item", chat: chatItem });
      });
    });
    return items;
  }, [groupedChats]);

  const sidebarScrollRef = useRef<HTMLDivElement>(null);

  const sidebarVirtualizer = useVirtualizer({
    count: flatSidebarItems.length,
    getScrollElement: () => sidebarScrollRef.current,
    estimateSize: (i) => (flatSidebarItems[i].type === "header" ? 28 : 34),
    overscan: 15,
  });

  const sidebarVirtualItems = sidebarVirtualizer.getVirtualItems();

  // Function to fork a chat (create a new chat with copied messages)
  const forkChat = useCallback(
    async (chatToFork: (typeof chats)[0]) => {
      const newChat = await createChat();

      // Copy all the properties from the original chat
      const forkSuffix = " (Fork)";
      updateChat(newChat.id, () => ({
        title: chatToFork.title ? `${chatToFork.title}${forkSuffix}` : "Forked Chat",
        customTitle: chatToFork.customTitle ? `${chatToFork.customTitle}${forkSuffix}` : undefined,
        model: chatToFork.model,
        messages: [...chatToFork.messages],
      }));

      // Navigate to the new forked chat
      openChat(newChat.id);

      requestAnimationFrame(() => {
        if (window.innerWidth < 768) {
          setShowSidebar(false);
        }
      });
    },
    [createChat, updateChat, openChat, setShowSidebar],
  );

  return (
    <div className="flex flex-col h-full w-full bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md">
      {/* Static header with buttons */}
      <div className="flex items-center px-2 py-2 md:px-1 md:py-1 shrink-0 h-14 md:h-10 gap-1">
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden" ref={sidebarScrollRef}>
        <div
          className="pt-2 pb-1 px-1"
          style={{ height: sidebarVirtualizer.getTotalSize(), width: "100%", position: "relative" }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${sidebarVirtualItems[0]?.start ?? 0}px)`,
            }}
          >
            {sidebarVirtualItems.map((virtualRow) => {
              const item = flatSidebarItems[virtualRow.index];
              if (item.type === "header") {
                const group = item.group;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={sidebarVirtualizer.measureElement}
                    className={item.groupIndex > 0 ? "pt-2" : ""}
                  >
                    <div className="flex items-center justify-between pl-1.5 pr-0.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide group/section">
                      <span>{group.category}</span>
                      <Menu>
                        <MenuButton
                          className="opacity-0 group-hover/section:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-0 rounded hover:bg-white/30 dark:hover:bg-black/20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical size={16} />
                        </MenuButton>
                        <MenuItems
                          modal={false}
                          transition
                          anchor="bottom end"
                          className="w-40 origin-top-right rounded-md border border-white/20 dark:border-white/15 bg-white/90 dark:bg-black/90 backdrop-blur-lg shadow-lg transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] data-closed:scale-95 data-closed:opacity-0 z-50"
                        >
                          <MenuItem>
                            <button
                              type="button"
                              onClick={() => {
                                const hasActive = group.chats.some((c) => c.id === chat?.id);
                                group.chats.forEach((chatItem) => deleteChat(chatItem.id));
                                if (hasActive) newChat();
                              }}
                              className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                            >
                              <Trash size={14} />
                              Delete All
                            </button>
                          </MenuItem>
                        </MenuItems>
                      </Menu>
                    </div>
                  </div>
                );
              }

              const chatItem = item.chat;
              return (
                <div key={virtualRow.key} data-index={virtualRow.index} ref={sidebarVirtualizer.measureElement}>
                  <div
                    onClick={() => {
                      openChat(chatItem.id);
                      if (window.innerWidth < 768) {
                        setShowSidebar(false);
                      }
                    }}
                    className={`flex items-center cursor-pointer relative shrink-0 group rounded transition-all duration-200 ${
                      chatItem.id === chat?.id
                        ? "py-2 md:py-1.5 px-2.5 md:px-2 text-neutral-900 dark:text-neutral-100 focus:outline-none"
                        : "py-2 md:py-1.5 pl-2.5 md:pl-2.5 pr-1 md:pr-0.5 hover:text-neutral-600 dark:hover:text-neutral-300"
                    }`}
                  >
                    {renamingChatId === chatItem.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRename();
                          if (e.key === "Escape") cancelRename();
                        }}
                        onBlur={confirmRename}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 px-1 py-0 text-base md:text-sm bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-600 rounded outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    ) : (
                      <div
                        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base md:text-sm text-neutral-800 dark:text-neutral-200 pr-4"
                        title={chatItem.customTitle ?? chatItem.title ?? "Untitled"}
                      >
                        {chatItem.customTitle ?? chatItem.title ?? "Untitled"}
                      </div>
                    )}
                    {renamingChatId !== chatItem.id && (
                    <Menu>
                      <MenuButton
                        className="absolute right-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 p-0 rounded hover:bg-white/30 dark:hover:bg-black/20"
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
                            onClick={() => startRename(chatItem)}
                            className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 "
                          >
                            <Pencil size={14} />
                            Rename
                          </button>
                        </MenuItem>
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
                            onClick={() => {
                              const wasActive = chatItem.id === chat?.id;
                              deleteChat(chatItem.id);
                              if (wasActive) newChat();
                            }}
                            className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 "
                          >
                            <Trash size={14} />
                            Delete
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
