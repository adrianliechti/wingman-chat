import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

// ─── Panel ───────────────────────────────────────────────────────────────────

const PANEL_CLASS =
  "z-50 rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1 overflow-auto transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0";

// ─── Item base classes ────────────────────────────────────────────────────────

const ITEM_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-800 dark:text-neutral-200 transition-colors data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 text-left";

const ITEM_DESTRUCTIVE_CLASS =
  "group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 transition-colors data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-left";

// ─── Divider ─────────────────────────────────────────────────────────────────

export function DropdownMenuDivider() {
  return <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />;
}

// ─── Label ───────────────────────────────────────────────────────────────────

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
      {children}
    </div>
  );
}

// ─── Item ────────────────────────────────────────────────────────────────────

export interface DropdownMenuItemProps {
  /** Icon rendered before the label. */
  icon?: ReactNode;
  /** Secondary line below the label. */
  description?: string;
  /** Red destructive styling. */
  destructive?: boolean;
  /** Renders a checkmark at the trailing edge. */
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** Render-prop escape hatch — receives the base className string. */
  render?: (props: { className: string; children: ReactNode }) => ReactNode;
}

export function DropdownMenuItem({
  icon,
  description,
  destructive = false,
  selected = false,
  onClick,
  disabled,
  children,
  render,
}: DropdownMenuItemProps) {
  const baseClass = destructive ? ITEM_DESTRUCTIVE_CLASS : ITEM_CLASS;

  const inner = (
    <>
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={selected ? "font-semibold" : undefined}>{children}</span>
        {description && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug font-normal">
            {description}
          </span>
        )}
      </span>
      {selected && <Check size={13} className="shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />}
    </>
  );

  return (
    <MenuItem disabled={disabled}>
      {render ? (
        render({ className: baseClass, children: inner })
      ) : (
        <button type="button" onClick={onClick} disabled={disabled} className={baseClass}>
          {inner}
        </button>
      )}
    </MenuItem>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export interface DropdownMenuProps {
  /** Render-prop for the trigger button. Receives the MenuButton component and className helper. */
  trigger: ReactNode;
  /** Headless UI anchor — e.g. "bottom start", "bottom end", "top start". */
  anchor?: string;
  /** Extra classes appended to the panel. Useful for min-w, max-h overrides. */
  panelClassName?: string;
  children: ReactNode;
}

export function DropdownMenu({ trigger, anchor = "bottom start", panelClassName, children }: DropdownMenuProps) {
  return (
    <Menu>
      {trigger}
      <MenuItems
        modal={false}
        transition
        anchor={anchor as Parameters<typeof MenuItems>[0]["anchor"]}
        className={[PANEL_CLASS, panelClassName].filter(Boolean).join(" ")}
      >
        {children}
      </MenuItems>
    </Menu>
  );
}

// Re-export MenuButton so callers can use it directly as the trigger element
// when they need fine-grained control (e.g. icon-only buttons, disabled state).
export { Menu, MenuButton, MenuItem, MenuItems };
