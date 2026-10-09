import { Description, Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SelectMenuOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
  description?: string;
}

interface SelectMenuProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SelectMenuOption<T>[];
  /** Label rendered above the button. */
  label?: string;
  /** Supporting text displayed inside the selected value. */
  description?: string;
  /** Help text below the control, associated with its accessible description. */
  hint?: string;
  disabled?: boolean;
  /** Placeholder shown when value is null/undefined and doesn't match any option. */
  placeholder?: string;
  /** Extra classes on the root wrapper. */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SelectMenu<T extends string | null>({
  value,
  onChange,
  options,
  label,
  description,
  hint,
  disabled = false,
  placeholder = "Select…",
  className,
}: SelectMenuProps<T>) {
  const selected = options.find((o) => o.value === value);

  return (
    <Field className={cn("min-w-0", className)} disabled={disabled}>
      {label && (
        <Label className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</Label>
      )}
      <Listbox value={value} onChange={onChange}>
        <ListboxButton
          aria-label={label ? undefined : placeholder}
          className="relative w-full rounded-lg border border-neutral-300/50 bg-white/50 py-2.5 pl-3 pr-10 text-left text-sm text-neutral-900 transition-colors backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400/60 data-open:border-neutral-400/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/50 dark:text-neutral-100 dark:focus-visible:ring-neutral-500/60 dark:data-open:border-neutral-500/70"
        >
          <span className="flex min-w-0 items-center gap-2 text-neutral-800 dark:text-neutral-200">
            {selected?.icon && <span className="shrink-0 text-neutral-400">{selected.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{selected?.label ?? placeholder}</span>
              {description && (
                <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {description}
                </span>
              )}
            </span>
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
            <ChevronsUpDown size={14} className="text-neutral-400" aria-hidden="true" />
          </span>
        </ListboxButton>

        <ListboxOptions
          anchor="bottom"
          modal={false}
          transition
          className="mt-1 w-(--button-width) max-h-60 overflow-auto rounded-xl border border-neutral-200/80 dark:border-white/10 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-1 z-[200] transition duration-100 ease-in data-closed:opacity-0"
        >
          {options.map((option) => (
            <ListboxOption
              key={String(option.value)}
              value={option.value}
              className="group relative flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg text-sm text-neutral-800 dark:text-neutral-200 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5"
            >
              {/* leading checkmark column */}
              <span className="w-4 shrink-0 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                <Check size={13} className="opacity-0 group-data-selected:opacity-100" aria-hidden="true" />
              </span>
              {option.icon && <span className="shrink-0 text-neutral-400">{option.icon}</span>}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="truncate font-normal group-data-selected:font-semibold">{option.label}</span>
                {option.description && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
                    {option.description}
                  </span>
                )}
              </span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
      {hint && <Description className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">{hint}</Description>}
    </Field>
  );
}
