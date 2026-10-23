import { Menu, MenuButton, MenuItem, MenuItems, Portal, Transition } from "@headlessui/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { BACKDROP_CLASS, ITEM_CLASS, ITEM_DESTRUCTIVE_CLASS, PANEL_CLASS } from "./menuStyles";

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
  /** Escape hatch when the handler needs the click event (e.g. modifier keys). */
  onClickEvent?: (e: React.MouseEvent) => void;
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
  onClickEvent,
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
        <button
          type="button"
          onClick={(e) => {
            onClickEvent?.(e);
            onClick?.();
          }}
          disabled={disabled}
          className={baseClass}
        >
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
  /** Dim the page while open. For top-level pickers, not small row menus. */
  backdrop?: boolean;
  children: ReactNode;
}

// The panel unfolds from its trigger: it grows from the anchored corner and
// slides in from the trigger's side. Literal classes so Tailwind can see them.
const ANCHOR_MOTION: Record<string, string> = {
  "bottom start": "origin-top-left data-closed:-translate-y-1.5",
  "bottom end": "origin-top-right data-closed:-translate-y-1.5",
  bottom: "origin-top data-closed:-translate-y-1.5",
  "top start": "origin-bottom-left data-closed:translate-y-1.5",
  "top end": "origin-bottom-right data-closed:translate-y-1.5",
  top: "origin-bottom data-closed:translate-y-1.5",
};

export function DropdownMenu({
  trigger,
  anchor = "bottom start",
  panelClassName,
  backdrop,
  children,
}: DropdownMenuProps) {
  return (
    <Menu>
      {({ open }) => (
        <>
          {trigger}
          {backdrop && (
            // Portaled: a fixed element inside a blurred header would be
            // positioned relative to the header instead of the viewport.
            <Portal>
              <Transition show={open}>
                <div aria-hidden="true" className={BACKDROP_CLASS} />
              </Transition>
            </Portal>
          )}
          <MenuItems
            modal={false}
            transition
            anchor={anchor as Parameters<typeof MenuItems>[0]["anchor"]}
            className={[PANEL_CLASS, ANCHOR_MOTION[anchor], panelClassName].filter(Boolean).join(" ")}
          >
            {children}
          </MenuItems>
        </>
      )}
    </Menu>
  );
}

// Re-export MenuButton so callers can use it directly as the trigger element
// when they need fine-grained control (e.g. icon-only buttons, disabled state).
export { Menu, MenuButton, MenuItem, MenuItems };
