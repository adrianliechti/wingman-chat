import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface SectionProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  isOpen: boolean;
  onOpenToggle?: () => void;
  collapsible?: boolean;
  overflowVisible?: boolean;
  headerAction?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  children: React.ReactNode;
}

export function Section({
  title,
  icon,
  count,
  isOpen,
  onOpenToggle,
  collapsible = true,
  overflowVisible = false,
  headerAction,
  className,
  headerClassName,
  children,
}: SectionProps) {
  return (
    <div className={className}>
      <div className={cn("flex items-center gap-2 px-4 pt-5 pb-2", headerClassName)}>
        {collapsible ? (
          <button
            type="button"
            onClick={onOpenToggle}
            className="flex-1 flex items-center justify-between py-0.5 text-left"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-400">
                {title}
              </span>
              {count !== undefined && count > 0 && (
                <span className="inline-flex items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-100/60 dark:bg-neutral-800/60 px-1.5 text-[10px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                  {count}
                </span>
              )}
            </span>
            <ChevronRight
              size={12}
              className={cn(
                "text-neutral-400 dark:text-neutral-500 transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
          </button>
        ) : (
          <div className="flex-1 flex items-center py-0.5">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-400">
                {title}
              </span>
              {count !== undefined && count > 0 && (
                <span className="inline-flex items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-100/60 dark:bg-neutral-800/60 px-1.5 text-[10px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                  {count}
                </span>
              )}
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
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
