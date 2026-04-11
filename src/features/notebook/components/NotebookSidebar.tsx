import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { MoreVertical, PanelRightOpen, Pencil, Search, Trash, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "@/shell/hooks/useSidebar";
import type { Notebook } from "../types/notebook";

interface NotebookSidebarProps {
  notebooks: Notebook[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, customTitle: string | undefined) => void;
  onNew: () => void;
}

export function NotebookSidebar({ notebooks, activeId, onSelect, onDelete, onRename, onNew }: NotebookSidebarProps) {
  const { setShowSidebar } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = useCallback((notebook: Notebook) => {
    setRenamingId(notebook.id);
    setRenameValue(notebook.customTitle ?? notebook.title ?? "");
  }, []);

  const confirmRename = useCallback(() => {
    if (renamingId) {
      const trimmed = renameValue.trim();
      onRename(renamingId, trimmed || undefined);
      setRenamingId(null);
    }
  }, [renamingId, renameValue, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const sorted = useMemo(
    () => [...notebooks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [notebooks],
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((n) => (n.customTitle ?? n.title).toLowerCase().includes(q));
  }, [sorted, searchQuery]);

  const getDateCategory = useCallback((dateStr: string): string => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const date = new Date(dateStr);
    const chatDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (chatDate.getTime() === today.getTime()) return "Today";

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (chatDate.getTime() === yesterday.getTime()) return "Yesterday";

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    if (chatDate > weekAgo) return "This Week";

    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    if (chatDate > twoWeeksAgo) return "Last Week";

    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    if (chatDate > monthAgo) return "Last Month";

    return "Older";
  }, []);

  const grouped = useMemo(() => {
    const categoryOrder = ["Today", "Yesterday", "This Week", "Last Week", "Last Month", "Older"];
    const map = new Map<string, Notebook[]>();

    filtered.forEach((n) => {
      const cat = getDateCategory(n.updatedAt);
      if (!map.has(cat)) map.set(cat, []);
      const notebooksInCategory = map.get(cat);
      if (notebooksInCategory) {
        notebooksInCategory.push(n);
      }
    });

    return categoryOrder
      .map((category) => {
        const items = map.get(category);
        return items && items.length > 0 ? { category, items } : null;
      })
      .filter((group): group is { category: string; items: Notebook[] } => group !== null);
  }, [filtered, getDateCategory]);

  const handleSelect = (id: string) => {
    onSelect(id);
    if (window.innerWidth < 768) {
      setShowSidebar(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center px-2 py-2 md:px-1 md:py-1 shrink-0 h-14 md:h-10 gap-1">
        {showSearch ? (
          <div className="flex-1 flex items-center gap-1">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notebooks..."
              className="w-full min-w-0 px-2 py-0.5 text-sm bg-transparent text-neutral-800 dark:text-neutral-200 placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
              className="p-2 md:p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
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
              >
                <Search size={20} />
              </button>
              <button
                type="button"
                onClick={() => setShowSidebar(false)}
                className="p-2 md:p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/30 dark:hover:bg-black/20 rounded transition-all duration-200"
              >
                <PanelRightOpen size={20} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="pt-2 pb-1 px-1">
          {grouped.map((group, gi) => (
            <div key={group.category} className={gi > 0 ? "pt-2" : ""}>
              {/* Category header */}
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
                          const hasActive = group.items.some((n) => n.id === activeId);
                          group.items.forEach((n) => {
                            onDelete(n.id);
                          });
                          if (hasActive) onNew();
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

              {/* Items */}
              {group.items.map((notebook) => (
                <div
                  key={notebook.id}
                  className={`flex items-center cursor-pointer relative shrink-0 group rounded transition-all duration-200 ${
                    notebook.id === activeId
                      ? "py-2 md:py-1.5 px-2.5 md:px-2 text-neutral-900 dark:text-neutral-100"
                      : "py-2 md:py-1.5 pl-2.5 md:pl-2.5 pr-1 md:pr-0.5 hover:text-neutral-600 dark:hover:text-neutral-300"
                  }`}
                >
                  {renamingId === notebook.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") confirmRename();
                        else if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={confirmRename}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 text-base md:text-sm bg-transparent text-neutral-800 dark:text-neutral-200 border-0 border-b border-neutral-400 dark:border-neutral-500 rounded-none px-0 py-0 focus:outline-none focus:border-neutral-600 dark:focus:border-neutral-300"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelect(notebook.id)}
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap pr-4 text-left text-base md:text-sm text-neutral-800 dark:text-neutral-200"
                      title={notebook.customTitle ?? notebook.title}
                    >
                      {notebook.customTitle ?? notebook.title}
                    </button>
                  )}
                  {renamingId !== notebook.id && (
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
                            onClick={() => startRename(notebook)}
                            className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                          >
                            <Pencil size={14} />
                            Rename
                          </button>
                        </MenuItem>
                        <MenuItem>
                          <button
                            type="button"
                            onClick={() => {
                              const wasActive = notebook.id === activeId;
                              onDelete(notebook.id);
                              if (wasActive) onNew();
                            }}
                            className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                          >
                            <Trash size={14} />
                            Delete
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>
                  )}
                </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-400">
              {searchQuery ? "No notebooks found" : "No notebooks yet"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
