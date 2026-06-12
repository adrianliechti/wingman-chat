import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "./DropdownMenu";

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

export function SelectorMenu({
  icon,
  label,
  options,
  onSelect,
  anchor = "bottom start",
  variant = "text",
  scrollable = false,
}: SelectorMenuProps) {
  const buttonClass =
    variant === "pill"
      ? "inline-flex items-center gap-2 px-4 py-2 bg-white/60 dark:bg-neutral-900/50 backdrop-blur-lg rounded-full border border-neutral-200/60 dark:border-neutral-700/50 text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 text-sm font-medium transition-all hover:bg-white/80 dark:hover:bg-neutral-900/70 shadow-sm"
      : "inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors";

  return (
    <DropdownMenu
      anchor={anchor}
      panelClassName={scrollable ? "max-h-[50vh]!" : undefined}
      trigger={
        <MenuButton className={buttonClass}>
          {icon}
          <span>{label}</span>
        </MenuButton>
      }
    >
      {options.map((option) => (
        <DropdownMenuItem key={option.value} onClick={() => onSelect(option.value)}>
          {option.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
