import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type { ReactNode } from "react";

export interface SelectorMenuOption {
  value: string;
  label: string;
}

interface SelectorMenuProps {
  icon: ReactNode;
  label: string;
  options: SelectorMenuOption[];
  onSelect: (value: string) => void;
  anchor?: "bottom" | "bottom start";
  variant?: "pill" | "text";
  scrollable?: boolean;
}

export function SelectorMenu({ icon, label, options, onSelect, anchor = "bottom start", variant = "text", scrollable = false }: SelectorMenuProps) {
  const buttonClass =
    variant === "pill"
      ? "inline-flex items-center gap-2 px-4 py-2 bg-white/60 dark:bg-neutral-900/50 backdrop-blur-lg rounded-full border border-neutral-200/60 dark:border-neutral-700/50 text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 text-sm font-medium transition-all hover:bg-white/80 dark:hover:bg-neutral-900/70 shadow-sm"
      : "inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors";

  const itemsClass = `${scrollable ? "max-h-[50vh]! " : ""}mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50`;

  return (
    <Menu>
      <MenuButton className={buttonClass}>
        {icon}
        <span>{label}</span>
      </MenuButton>
      <MenuItems modal={false} transition anchor={anchor} className={itemsClass}>
        {options.map((option) => (
          <MenuItem key={option.value}>
            <button type="button" onClick={() => onSelect(option.value)} className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors">
              {option.label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
