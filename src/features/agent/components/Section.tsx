import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface SectionProps {
  title: string;
  icon?: ReactNode;
  isOpen: boolean;
  onOpenToggle?: () => void;
  collapsible?: boolean;
  overflowVisible?: boolean;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({
  title,
  icon,
  isOpen,
  onOpenToggle,
  collapsible = true,
  overflowVisible = false,
  headerAction,
  children,
}: SectionProps) {
  return (
    <div className="border-b border-neutral-200/40 dark:border-neutral-700/40">
      <div className="flex items-center gap-1 px-3 py-2">
        {collapsible ? (
          <button
            type="button"
            onClick={onOpenToggle}
            className="flex-1 flex items-center justify-between py-1 text-left"
          >
            <div className="flex items-center gap-2">
              {icon && <span className="text-neutral-400 dark:text-neutral-500 shrink-0">{icon}</span>}
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {title}
              </span>
            </div>
            <ChevronRight
              size={13}
              className={cn("text-neutral-400 transition-transform duration-200", isOpen && "rotate-90")}
            />
          </button>
        ) : (
          <div className="flex-1 flex items-center gap-2 py-1">
            {icon && <span className="text-neutral-400 dark:text-neutral-500 shrink-0">{icon}</span>}
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              {title}
            </span>
          </div>
        )}
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className={cn(overflowVisible ? "overflow-visible" : "overflow-hidden")}>
          <div className="px-3 pb-3 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
