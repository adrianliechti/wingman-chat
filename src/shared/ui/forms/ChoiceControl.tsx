import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** Native selection semantics shared by Inline UI and question forms. */
export function ChoiceControl({
  children,
  chip = false,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "type"> & {
  type: "checkbox" | "radio";
  children: ReactNode;
  chip?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg text-sm leading-5 text-neutral-700 transition-colors motion-reduce:transition-none dark:text-neutral-200",
        chip ? "border px-3 py-2 shadow-xs" : "py-1.5",
        chip &&
          (input.checked
            ? "border-neutral-400/70 bg-neutral-100 text-neutral-950 dark:border-neutral-500 dark:bg-neutral-800 dark:text-white"
            : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60"),
        input.disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input {...input} className="inline-choice-input" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </label>
  );
}
