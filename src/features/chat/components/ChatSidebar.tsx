import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GitBranch, MoreVertical, PanelRightOpen, Pencil, Pin, PinOff, Search, Trash, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { type Chat, getTextFromContent } from "@/shared/types/chat";
import { useSidebar } from "@/shell/hooks/useSidebar";

export function ChatSidebar() {
  const { chats, chat, deleteChat, createChat, updateChat } = useChat();
  const { setShowSidebar } = useSidebar();
  const { newChat, openChat } = useChatNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const dragItemId = useRef<string | null>(null);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  const startRename = useCallback((chatItem: Chat) => {
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

  const pinChat = useCallback(
    (chatItem: Chat) => {
      const maxPin = chats.reduce((max, c) => Math.max(max, c.customIndex ?? 0), 0);
      updateChat(chatItem.id, () => ({ customIndex: maxPin + 1 }));
    },
    [chats, updateChat],
  );

  const unpinChat = useCallback(
    (chatItem: Chat) => {
      updateChat(chatItem.id, () => ({ customIndex: undefined }));
    },
    [updateChat],
  );

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

  // Split pinned and unpinned chats
  const { pinnedChats, unpinnedChats } = useMemo(() => {
    const pinned = filteredChats.filter((c) => c.customIndex != null);
    const unpinned = filteredChats.filter((c) => c.customIndex == null);

    // Sort pinned by customIndex, then by updated date as tiebreaker
    pinned.sort((a, b) => {
      const diff = (a.customIndex ?? 0) - (b.customIndex ?? 0);
      if (diff !== 0) return diff;
      return new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime();
    });

    return { pinnedChats: pinned, unpinnedChats: unpinned };
  }, [filteredChats]);

  // Group unpinned chats by date category (pinned rendered separately)
  const groupedChats = useMemo(() => {
    const groups: { category: string; chats: typeof unpinnedChats }[] = [];
    const categoryOrder = ["Today", "Yesterday", "This Week", "Last Week", "Last Month", "Older"];
    const categoryMap = new Map<string, typeof unpinnedChats>();

    unpinnedChats.forEach((chatItem) => {
      const date = new Date(chatItem.updated || chatItem.created || 0);
      const category = getDateCategory(date);

      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(chatItem);
    });

    categoryOrder.forEach((category) => {
      const chats = categoryMap.get(category);
      if (chats && chats.length > 0) {
        groups.push({ category, chats });
      }
    });

    return groups;
  }, [unpinnedChats, getDateCategory]);

  // Flatten grouped chats into a single list for virtualization (unpinned only)
  type FlatSidebarItem =
    | { type: "header"; group: (typeof groupedChats)[0]; groupIndex: number }
    | { type: "item"; chat: Chat };

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
    async (chatToFork: Chat) => {
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

  // Drag-and-drop handlers for pinned chats
  const handleDragStart = useCallback((chatId: string) => {
    dragItemId.current = chatId;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, chatId: string) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragOver((prev) => (prev?.id === chatId && prev.position === position ? prev : { id: chatId, position }));
  }, []);

  const handleDragEnd = useCallback(() => {
    dragItemId.current = null;
    setDragOver(null);
  }, []);

  const handleDrop = useCallback(
    (targetId: string) => {
      const sourceId = dragItemId.current;
      const position = dragOver?.position ?? "before";
      if (!sourceId || sourceId === targetId) {
        setDragOver(null);
        return;
      }

      const reordered = [...pinnedChats];
      const sourceIdx = reordered.findIndex((c) => c.id === sourceId);
      let targetIdx = reordered.findIndex((c) => c.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;

      const [moved] = reordered.splice(sourceIdx, 1);
      // Adjust target index after removal
      if (sourceIdx < targetIdx) targetIdx--;
      const insertIdx = position === "after" ? targetIdx + 1 : targetIdx;
      reordered.splice(insertIdx, 0, moved);

      reordered.forEach((c, i) => {
        updateChat(c.id, () => ({ customIndex: i + 1 }));
      });

      setDragOver(null);
      dragItemId.current = null;
    },
    [pinnedChats, dragOver, updateChat],
  );

  // Shared chat item row renderer
  const renderChatItem = (chatItem: Chat, options?: { draggable?: boolean }) => {
    const displayTitle = chatItem.customTitle ?? chatItem.title ?? "Untitled";
    const isActive = chatItem.id === chat?.id;
    const dragBorder =
      dragOver?.id === chatItem.id
        ? dragOver.position === "before"
          ? "border-t-2 border-neutral-400 dark:border-neutral-500"
          : "border-b-2 border-neutral-400 dark:border-neutral-500"
        : "";

    return (
      <div
        draggable={options?.draggable}
        onDragStart={options?.draggable ? () => handleDragStart(chatItem.id) : undefined}
        onDragOver={options?.draggable ? (e) => handleDragOver(e, chatItem.id) : undefined}
        onDragEnd={options?.draggable ? handleDragEnd : undefined}
        onDrop={options?.draggable ? () => handleDrop(chatItem.id) : undefined}
        onClick={() => {
          openChat(chatItem.id);
          if (window.innerWidth < 768) {
            setShowSidebar(false);
          }
        }}
        className={`flex items-center cursor-pointer relative shrink-0 group rounded transition-all duration-200 py-2 md:py-1.5 pl-2.5 md:pl-2.5 pr-1 md:pr-0.5 ${dragBorder} ${
          isActive ? "text-neutral-900 dark:text-neutral-100" : "hover:text-neutral-600 dark:hover:text-neutral-300"
        }`}
      >
        {isActive && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
        )}
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
            title={displayTitle}
          >
            {displayTitle}
          </div>
        )}
        {renamingChatId !== chatItem.id && (
          <Menu>
            <MenuButton
              className="absolute right-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 p-0.5 rounded hover:bg-white/30 dark:hover:bg-black/20"
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
                {chatItem.customIndex != null ? (
                  <button
                    type="button"
                    onClick={() => unpinChat(chatItem)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 "
                  >
                    <PinOff size={14} />
                    Unpin
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pinChat(chatItem)}
                    className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 "
                  >
                    <Pin size={14} />
                    Pin
                  </button>
                )}
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
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md">
      {/* Static header with buttons */}
      <div className="flex items-center px-2 py-2 md:px-1 md:py-1 shrink-0 h-14 md:h-10 gap-1">
        {showSearch ? (
          <div className="flex-1 flex items-center gap-1">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full min-w-0 px-2 py-0.5 text-sm bg-transparent text-neutral-800 dark:text-neutral-200 placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none"
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
        {/* Pinned chats section (non-virtualized, drag-and-drop) */}
        {pinnedChats.length > 0 && (
          <div className="pl-1 pr-2 pt-2">
            <div className="flex items-center justify-between pl-1.5 pr-0.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide group/section">
              <span>Pinned</span>
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
                        pinnedChats.forEach((c) => {
                          unpinChat(c);
                        });
                      }}
                      className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                    >
                      <PinOff size={14} />
                      Unpin All
                    </button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            </div>
            {pinnedChats.map((chatItem) => (
              <div key={chatItem.id}>{renderChatItem(chatItem, { draggable: true })}</div>
            ))}
          </div>
        )}

        {/* Unpinned chats (virtualized) */}
        <div
          className="pt-2 pb-1 pl-1 pr-2"
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
                                group.chats.forEach((chatItem) => {
                                  deleteChat(chatItem.id);
                                });
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
                  {renderChatItem(chatItem)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
