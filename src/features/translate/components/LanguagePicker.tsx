import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Popover,
  PopoverButton,
  PopoverPanel,
  useClose,
} from "@headlessui/react";
import { Check, ChevronDown, GlobeIcon, Search } from "lucide-react";
import { useState } from "react";
import type { Language, TranslatorProvider } from "../lib/languages";
import { cn } from "@/shared/lib/cn";
import { ITEM_CLASS, PANEL_CLASS } from "@/shared/ui/menuStyles";

interface LanguagePickerProps {
  value: string;
  languages: Language[];
  onChange: (code: string) => void;
  /** Shown as a switch inside the panel when more than one translator is configured. */
  providers?: TranslatorProvider[];
  provider?: string;
  onProviderChange?: (id: string) => void;
  /** A reason a translator cannot be chosen right now (e.g. it rejects the open document). */
  providerDisabledReason?: (provider: TranslatorProvider) => string | null;
  anchor?: "bottom" | "bottom start" | "bottom end";
  disabled?: boolean;
  className?: string;
}

const BUTTON_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200/70 bg-white/70 py-1.5 pr-2.5 pl-3 text-sm font-medium text-neutral-800 shadow-sm backdrop-blur-sm transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700/70 dark:bg-neutral-900/70 dark:text-neutral-100 dark:hover:bg-neutral-900";

const ANCHOR_MOTION = {
  bottom: "origin-top data-closed:-translate-y-1.5",
  "bottom start": "origin-top-left data-closed:-translate-y-1.5",
  "bottom end": "origin-top-right data-closed:-translate-y-1.5",
};

/** Target language picker; also switches the translator when several are configured. */
export function LanguagePicker({
  value,
  languages,
  onChange,
  providers = [],
  provider,
  onProviderChange,
  providerDisabledReason,
  anchor = "bottom",
  disabled,
  className,
}: LanguagePickerProps) {
  const selected = languages.find((language) => language.code === value);
  const selectedProvider = providers.find((item) => item.id === provider);

  return (
    // min-w-0 lets the button shrink in a crowded header; the language name then truncates.
    <Popover className="min-w-0 max-w-full">
      <PopoverButton className={cn(BUTTON_CLASS, className)} disabled={disabled} aria-label="Target language">
        <GlobeIcon size={15} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span className="shrink-0 truncate">{selected?.name || value || "Choose a language"}</span>
        {providers.length > 1 && selectedProvider && (
          <span className="hidden min-w-0 truncate font-normal text-neutral-400 sm:inline dark:text-neutral-500">
            · {selectedProvider.name}
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-neutral-400" />
      </PopoverButton>
      <PopoverPanel
        transition
        anchor={anchor}
        className={cn(PANEL_CLASS, ANCHOR_MOTION[anchor], "flex w-72 flex-col overflow-hidden [--anchor-gap:6px]")}
      >
        <PickerPanel
          value={value}
          languages={languages}
          onChange={onChange}
          providers={providers}
          provider={provider}
          onProviderChange={onProviderChange}
          providerDisabledReason={providerDisabledReason}
        />
      </PopoverPanel>
    </Popover>
  );
}

// Mounted only while open, so the search query starts empty each time.
function PickerPanel({
  value,
  languages,
  onChange,
  providers,
  provider,
  onProviderChange,
  providerDisabledReason,
}: Omit<LanguagePickerProps, "anchor" | "disabled" | "className"> & { providers: TranslatorProvider[] }) {
  const close = useClose();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = q
    ? languages.filter((language) =>
        [language.name, language.nativeName, language.code].some((text) => text?.toLowerCase().includes(q)),
      )
    : languages;

  const select = (code: string | null) => {
    if (!code) return;
    onChange(code);
    close();
  };

  return (
    <>
      {providers.length > 1 && onProviderChange && (
        <div
          role="radiogroup"
          aria-label="Translator"
          className="mb-1 flex gap-0.5 rounded-lg bg-neutral-100/70 p-0.5 dark:bg-white/5"
        >
          {providers.map((item) => {
            const reason = providerDisabledReason?.(item) ?? null;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === provider}
                disabled={!!reason}
                title={reason ?? item.description}
                onClick={() => onProviderChange(item.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  item.id === provider
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
                )}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      )}

      <Combobox value={value} onChange={select}>
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-neutral-100/70 px-2 py-1.5 dark:bg-white/5">
          <Search size={13} className="shrink-0 text-neutral-400" />
          <ComboboxInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search languages…"
            aria-label="Search languages"
            className="w-full bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-200"
          />
        </div>

        <ComboboxOptions static className="max-h-72 overflow-y-auto scrollbar-thin">
          {matches.map((language) => (
            <ComboboxOption key={language.code} value={language.code} className={cn(ITEM_CLASS, "cursor-default")}>
              {({ selected }) => (
                <>
                  <span className={cn("min-w-0 flex-1 truncate", selected && "font-semibold")}>{language.name}</span>
                  {language.nativeName && (
                    <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {language.nativeName}
                    </span>
                  )}
                  <Check
                    size={13}
                    aria-hidden="true"
                    className={cn("shrink-0 text-neutral-500 dark:text-neutral-400", !selected && "invisible")}
                  />
                </>
              )}
            </ComboboxOption>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {q ? `No languages match “${query.trim()}”` : "No languages available"}
            </div>
          )}
        </ComboboxOptions>
      </Combobox>
    </>
  );
}
