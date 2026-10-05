import { ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/shared/lib/cn";

interface CatalogToggleProps {
  enabled: boolean;
  label: string;
  onToggle: () => void;
}

export function CatalogToggle({ enabled, label, onToggle }: CatalogToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "shrink-0 rounded-md p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400",
        enabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500",
      )}
    >
      {enabled ? <ToggleRight size={20} aria-hidden="true" /> : <ToggleLeft size={20} aria-hidden="true" />}
    </button>
  );
}
