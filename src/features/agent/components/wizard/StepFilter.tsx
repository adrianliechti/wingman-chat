import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface StepFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/** Collapsed "Filter" button that expands into an inline search field; clears the query when collapsed. */
export function StepFilter({ value, onChange }: StepFilterProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      onChange("");
    }
  }, [open, onChange]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-mr-2 ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/50 transition-colors"
      >
        <Search size={11} /> Filter
      </button>
    );
  }

  return (
    <div className="relative flex-1">
      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
        placeholder="Filter…"
        className="w-full pl-7 pr-7 py-1 text-xs rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        <X size={11} />
      </button>
    </div>
  );
}
