import { Minus, Plus } from "lucide-react";
import { cn } from "@/shared/lib/cn";

interface OfficeZoomControlsProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function OfficeZoomControls({
  value,
  onChange,
  min = 0.5,
  max = 2,
  step = 0.25,
  className,
}: OfficeZoomControlsProps) {
  const update = (delta: number) => onChange(Math.max(min, Math.min(max, value + delta)));

  return (
    <div
      className={cn("flex h-full shrink-0 items-center gap-0.5 px-1.5 text-neutral-500", className)}
      role="group"
      aria-label="Zoom"
    >
      <button
        type="button"
        onClick={() => update(-step)}
        disabled={value <= min}
        className="grid size-6 place-items-center rounded hover:bg-neutral-200/70 hover:text-neutral-800 disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        aria-label="Zoom out"
      >
        <Minus size={13} />
      </button>
      <span className="w-10 text-center text-[11px] tabular-nums" aria-live="polite">
        {Math.round(value * 100)}%
      </span>
      <button
        type="button"
        onClick={() => update(step)}
        disabled={value >= max}
        className="grid size-6 place-items-center rounded hover:bg-neutral-200/70 hover:text-neutral-800 disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        aria-label="Zoom in"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
