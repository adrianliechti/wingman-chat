import { ChevronRight, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { ToolDisplayIcon } from "@/shared/types/chat";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";

type ActivityRowProps = {
  label: ReactNode;
  /** Muted text after the label (an argument preview or a live status). */
  detail?: ReactNode;
  mono?: boolean;
  running?: boolean;
  error?: boolean;
  /** Top-level rows only: nested rows rely on indentation instead. */
  icon?: ToolDisplayIcon | string;
  /** Makes the row a disclosure; omit for rows with nothing to expand. */
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
};

/**
 * The one row every agent activity uses: tools, tool groups, reasoning,
 * subagents. A fixed leading slot (spinner while running, chevron when it
 * expands) keeps labels aligned as a row goes from running to done.
 */
export function ActivityRow({
  label,
  detail,
  mono,
  running,
  error,
  icon: Icon,
  expanded,
  onToggle,
  className,
}: ActivityRowProps) {
  const muted = "text-neutral-400 dark:text-neutral-500";
  const content = (
    <>
      <span className="flex size-3 items-center justify-center">
        {running ? (
          <Loader2 aria-hidden="true" className={cn("size-3 animate-spin", muted)} />
        ) : onToggle ? (
          <ChevronRight
            aria-hidden="true"
            className={cn("size-3 transition-transform", muted, expanded && "rotate-90")}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {Icon &&
          (typeof Icon === "string" ? (
            <McpProviderIcon src={Icon} size={12} className={cn("size-3 shrink-0 object-contain", muted)} />
          ) : (
            <Icon aria-hidden="true" className={cn("size-3 shrink-0", muted)} />
          ))}
        <span
          className={cn(
            "min-w-0 truncate text-xs",
            mono ? "font-mono" : "font-medium",
            error ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400",
          )}
        >
          {label}
        </span>
        {detail && (
          // The detail gives way first so the label stays readable.
          <span className={cn("min-w-0 shrink-[4] truncate text-xs", muted, mono && "font-mono")}>{detail}</span>
        )}
      </span>
    </>
  );
  const layout = cn("grid w-full min-w-0 grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 text-left", className);
  return onToggle ? (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(layout, "transition-opacity hover:opacity-80")}
    >
      {content}
    </button>
  ) : (
    <div role={running ? "status" : undefined} className={layout}>
      {content}
    </div>
  );
}
