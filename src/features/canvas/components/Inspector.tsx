import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export type InspectorTab = "light" | "color" | "effects" | "crop" | "retouch" | "versions";

export interface InspectorTabMeta {
  id: InspectorTab;
  label: string;
  icon: ReactNode;
}

interface InspectorProps {
  tabs: InspectorTabMeta[];
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  /** Bottom sheet instead of a side panel. */
  compact: boolean;
  /** Small icon buttons beside the section title (undo, redo, reset). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Right-hand (or, on small screens, bottom) panel with icon tabs and per-tab actions. */
export function Inspector({ tabs, tab, onTab, compact, actions, children }: InspectorProps) {
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];
  return (
    <aside
      aria-label="Adjustments"
      className={cn(
        "flex shrink-0 flex-col bg-white/60 backdrop-blur-xl dark:bg-neutral-900/60",
        compact
          ? "max-h-[45dvh] border-t border-neutral-200/70 dark:border-neutral-800/70"
          : "w-72 border-l border-neutral-200/70 dark:border-neutral-800/70 xl:w-80",
      )}
    >
      <header className="px-3 pt-3">
        <div
          role="tablist"
          aria-label="Adjustment groups"
          className="flex items-center gap-0.5 rounded-xl bg-neutral-100/80 p-1 dark:bg-neutral-800/70"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === active.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => onTab(item.id)}
              className={cn(
                "flex flex-1 items-center justify-center rounded-lg py-1.5 transition-colors",
                item.id === active.id
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
              )}
            >
              {item.icon}
            </button>
          ))}
        </div>
        <div className="flex h-9 items-center justify-between gap-2 pl-1">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            {active.label}
          </h2>
          {actions && <div className="flex items-center gap-0.5">{actions}</div>}
        </div>
      </header>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {children}
      </div>
    </aside>
  );
}

/** Small icon button for the inspector header. */
export function InspectorAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200"
    >
      {children}
    </button>
  );
}

/** Group of sliders with a small heading. */
export function PanelSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5 py-2", className)}>
      {title && <h3 className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{title}</h3>}
      {children}
    </section>
  );
}
