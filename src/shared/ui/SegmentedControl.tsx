import { Description, Label, Radio, RadioGroup } from "@headlessui/react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function SegmentedControl<T extends string>({
  label,
  ariaLabel,
  description,
  value,
  onChange,
  options,
  sizing = "equal",
  disabled = false,
  invalid,
  errorId,
}: {
  label?: string;
  /** Names the group for assistive technology when no visible label is shown. */
  ariaLabel?: string;
  description?: ReactNode;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  /**
   * "equal" gives every segment the same width. "content" gives each the width
   * of its label plus a share of what is left, for labels of uneven length that
   * would otherwise break on a phone.
   */
  sizing?: "equal" | "content";
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
}) {
  return (
    <RadioGroup
      className="min-w-0"
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-errormessage={errorId}
    >
      {label && (
        <Label className="mb-1.5 block text-xs font-medium text-neutral-500 max-sm:text-[15px] max-sm:text-neutral-700 dark:text-neutral-400 max-sm:dark:text-neutral-200">
          {label}
        </Label>
      )}
      {description && (
        <Description className="mb-2.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          {description}
        </Description>
      )}
      <div className="flex w-full flex-wrap gap-1 rounded-xl border border-neutral-200/70 bg-neutral-100/70 p-1 max-sm:rounded-full max-sm:border-0 max-sm:bg-black/6 dark:border-neutral-700/60 dark:bg-neutral-800/60 max-sm:dark:bg-white/10">
        {options.map((option) => (
          <Radio
            as="button"
            type="button"
            key={option.value}
            value={option.value}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 max-sm:press max-sm:rounded-full max-sm:py-2.5 max-sm:text-sm transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 data-checked:bg-white data-checked:text-neutral-900 data-checked:shadow-sm data-checked:ring-1 data-checked:ring-black/5 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-200 dark:focus-visible:ring-neutral-500/60 dark:data-checked:bg-neutral-700 dark:data-checked:text-neutral-50 dark:data-checked:ring-white/10",
              sizing === "content" ? "flex-auto whitespace-nowrap" : "min-w-0 flex-1 break-words",
              option.icon && "inline-flex items-center justify-center gap-1.5",
            )}
          >
            {option.icon}
            {option.label}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
