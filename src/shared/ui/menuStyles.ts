// ─── Shared menu panel / item class strings ───────────────────────────────────
// Used by DropdownMenu and ModelDropdown to keep styles in sync.

export const PANEL_CLASS =
  "z-50 rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 overflow-auto transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0";

export const ITEM_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-800 dark:text-neutral-200 transition-colors data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 text-left";

export const ITEM_DESTRUCTIVE_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 transition-colors data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-left";
