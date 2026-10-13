import { useId, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { buttonClass, primaryButtonClass } from "@/shared/ui/forms/controlStyles";
import type { ToolDisplayIcon } from "@/shared/types/chat";

/** One quiet block for every agent request: approvals, forms and browser steps. */
export const requestCardClass =
  "min-w-0 w-full max-w-xl space-y-2 rounded-lg border border-neutral-200/80 px-3 py-2.5 text-[13px] leading-5 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300";
export const requestBodyClass = "space-y-3";
export const requestActionsClass = "flex flex-wrap items-center gap-1.5 pt-0.5";
/** The value a person checks before answering, as plain readable text. */
export const requestValueClass =
  "max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 sm:max-h-64 dark:text-neutral-200 [overflow-wrap:anywhere]";
export const requestButtonClass = cn(buttonClass, "min-h-7 rounded-md px-2.5 py-0.5 text-xs shadow-none");
export const primaryRequestButtonClass = cn(requestButtonClass, primaryButtonClass);
export const quietRequestButtonClass =
  "min-h-7 rounded-md px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-400/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100";

export function RequestHeader({
  id,
  title,
  source,
  icon: Icon,
  completed,
}: {
  id: string;
  title: string;
  source?: string;
  icon?: ToolDisplayIcon;
  completed?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <h3 id={id} className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100">
        {Icon && (
          <Icon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0",
              completed ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500",
            )}
          />
        )}
        <span className="min-w-0 break-words">{title}</span>
      </h3>
      {source && <span className="min-w-0 truncate text-xs text-neutral-400 dark:text-neutral-500">{source}</span>}
    </div>
  );
}

export function RequestCard({
  title,
  source,
  icon,
  completed,
  children,
  actions,
}: {
  title: string;
  source?: string;
  icon?: ToolDisplayIcon;
  completed?: boolean;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={requestCardClass}>
      <RequestHeader id={id} title={title} source={source} icon={icon} completed={completed} />
      {children}
      <div className={requestActionsClass}>{actions}</div>
    </section>
  );
}
