import { Description, Label, Radio, RadioGroup } from "@headlessui/react";
import type { ReactNode } from "react";

export function SegmentedControl<T extends string>({
  label,
  description,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label?: string;
  description?: ReactNode;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <RadioGroup className="min-w-0" value={value} onChange={onChange} disabled={disabled}>
      {label && (
        <Label className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</Label>
      )}
      {description && (
        <Description className="mb-2.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          {description}
        </Description>
      )}
      <div className="flex w-full flex-wrap gap-1 rounded-xl border border-neutral-200/70 bg-neutral-100/70 p-1 dark:border-neutral-700/60 dark:bg-neutral-800/60">
        {options.map((option) => (
          <Radio
            as="button"
            type="button"
            key={option.value}
            value={option.value}
            className="min-w-0 flex-1 break-words rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 data-checked:bg-white data-checked:text-neutral-900 data-checked:shadow-sm data-checked:ring-1 data-checked:ring-black/5 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-200 dark:focus-visible:ring-neutral-500/60 dark:data-checked:bg-neutral-700 dark:data-checked:text-neutral-50 dark:data-checked:ring-white/10"
          >
            {option.label}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
