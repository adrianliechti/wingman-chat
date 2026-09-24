// ─── Shared menu panel / item class strings ───────────────────────────────────
// Used by DropdownMenu and ModelDropdown to keep styles in sync.

export const PANEL_CLASS =
  "z-50 rounded-xl border border-neutral-200/80 dark:border-white/10 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-1 overflow-auto transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-leave:duration-150 data-closed:scale-96 data-closed:opacity-0 motion-reduce:transition-none";

// Dims the page behind top-level pickers so the open panel stands out.
export const BACKDROP_CLASS =
  "fixed inset-0 z-40 bg-black/10 dark:bg-black/40 transition-opacity duration-300 ease-out data-leave:duration-200 data-closed:opacity-0 motion-reduce:transition-none";

export const ITEM_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-800 dark:text-neutral-200 transition-colors data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 text-left";

export const ITEM_DESTRUCTIVE_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 transition-colors data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-left";
