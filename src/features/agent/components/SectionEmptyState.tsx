import type { ReactNode } from "react";

interface SectionEmptyStateProps {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick?: () => void;
}

export function SectionEmptyState({ icon, label, description, onClick }: SectionEmptyStateProps) {
  const baseClass =
    "w-full flex items-center justify-start gap-2.5 rounded-xl border border-dashed border-neutral-300/70 dark:border-neutral-700/60 bg-neutral-50/40 dark:bg-neutral-800/20 py-3 px-3";
  const interactiveClass =
    "group hover:border-neutral-400/70 dark:hover:border-neutral-600/70 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/40 transition-all duration-150";
  const iconClass = onClick
    ? "flex items-center justify-center w-6 h-6 rounded-full bg-neutral-200/60 dark:bg-neutral-700/50 group-hover:bg-neutral-300/60 dark:group-hover:bg-neutral-700/80 transition-colors shrink-0"
    : "flex items-center justify-center w-6 h-6 rounded-full bg-neutral-200/60 dark:bg-neutral-700/50 shrink-0";

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${baseClass} ${interactiveClass}`}>
        <div className={iconClass}>
          <span className="text-neutral-500 dark:text-neutral-400">{icon}</span>
        </div>
        <div className="text-left">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
          {description && <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{description}</p>}
        </div>
      </button>
    );
  }

  return (
    <div className={baseClass}>
      <div className={iconClass}>
        <span className="text-neutral-500 dark:text-neutral-400">{icon}</span>
      </div>
      <div className="text-left">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
        {description && <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{description}</p>}
      </div>
    </div>
  );
}
