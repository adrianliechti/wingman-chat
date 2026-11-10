import { useCallback, useEffect, useId, useRef } from "react";
import { cn } from "@/shared/lib/cn";

interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Value a double-click on the label restores (default 0). */
  reset?: number;
  /** Live value while dragging or typing. */
  onChange: (value: number) => void;
  /** The drag or edit finished; close the undo step. */
  onCommit?: () => void;
  disabled?: boolean;
  /** CSS background for the track, e.g. a temperature gradient. Fill is hidden when set. */
  track?: string;
  /** Fill color between the reset point and the thumb (default blue). */
  fill?: string;
  className?: string;
}

const decimals = (step: number) => (step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step))));

/**
 * Labelled slider with a typed value, a fill from the reset point and
 * double-click reset — the Lightroom slider idiom. A transparent native range
 * input sits on top for pointer, keyboard and screen-reader handling.
 */
export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step,
  reset = 0,
  onChange,
  onCommit,
  disabled,
  track,
  fill,
  className,
}: AdjustmentSliderProps) {
  const id = useId();
  const dragging = useRef(false);
  const position = ((value - min) / (max - min)) * 100;
  const origin = ((reset - min) / (max - min)) * 100;
  const digits = decimals(step);

  const commit = useCallback(
    function finishDrag() {
      dragging.current = false;
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      onCommit?.();
    },
    [onCommit],
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    },
    [commit],
  );

  // Range inputs drag internally, so the release may land outside the element:
  // listen on the window for the one pointerup that ends this drag.
  const startDrag = useCallback(() => {
    if (dragging.current) return;
    dragging.current = true;
    window.addEventListener("pointerup", commit, { once: true });
    window.addEventListener("pointercancel", commit, { once: true });
  }, [commit]);

  const clampValue = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className={cn("group/slider", disabled && "opacity-50", className)}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="truncate text-xs text-neutral-600 select-none dark:text-neutral-300"
          title="Double-click to reset"
          onDoubleClick={() => {
            if (disabled) return;
            onChange(reset);
            onCommit?.();
          }}
        >
          {label}
        </label>
        <input
          aria-label={`${label} value`}
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={Number(value.toFixed(digits))}
          onChange={(event) => {
            if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) {
              onChange(clampValue(event.target.valueAsNumber));
            }
          }}
          onBlur={() => onCommit?.()}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit?.();
          }}
          className="w-14 shrink-0 rounded bg-transparent px-1 text-right text-xs tabular-nums text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/5 dark:focus:bg-white/5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
      <div className="relative flex h-5 items-center">
        <div
          className={cn("absolute inset-x-0 h-1 rounded-full", !track && "bg-neutral-200 dark:bg-neutral-700")}
          style={track ? { background: track } : undefined}
        />
        {!track && (
          <div
            className="absolute h-1 rounded-full bg-blue-500 dark:bg-blue-400"
            style={{
              left: `${Math.min(position, origin)}%`,
              width: `${Math.abs(position - origin)}%`,
              background: fill,
            }}
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow ring-1 ring-black/15 transition-transform group-hover/slider:scale-110 dark:bg-neutral-100"
          style={{ left: `${position}%` }}
        />
        <input
          id={id}
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.valueAsNumber)}
          onPointerDown={startDrag}
          onBlur={commit}
          onKeyUp={() => onCommit?.()}
          onDoubleClick={() => {
            if (disabled) return;
            onChange(reset);
            onCommit?.();
          }}
          className="absolute inset-0 m-0 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
