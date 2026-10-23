import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/cn";

interface ActiveIndicatorProps {
  enabled: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}

/** Row status control: a dot when enabled, a "+" revealed on row hover/focus when not. Row must be `group/row`. */
export function ActiveIndicator({ enabled, label, onToggle, className }: ActiveIndicatorProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "absolute top-1/2 flex h-6 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400",
        enabled && "hover:bg-neutral-200/70 dark:hover:bg-neutral-700/60",
        className,
      )}
    >
      {enabled ? (
        <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" aria-hidden="true" />
      ) : (
        <Plus
          size={15}
          aria-hidden="true"
          className="text-neutral-400 opacity-0 transition-opacity group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 pointer-coarse:opacity-60 dark:text-neutral-500"
        />
      )}
    </button>
  );
}
