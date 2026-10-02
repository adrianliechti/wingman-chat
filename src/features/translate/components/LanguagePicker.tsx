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
import { Check, GlobeIcon, Search } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "@/features/translate/hooks/useTranslate";
import { cn } from "@/shared/lib/cn";
import { fileMatchesTypeList } from "@/shared/lib/fileTypes";
import { ITEM_CLASS, PANEL_CLASS } from "@/shared/ui/menuStyles";

interface LanguagePickerProps {
  anchor?: "bottom" | "bottom start";
  variant?: "pill" | "text";
}

// Matches SelectorMenu so the picker sits naturally beside the tone and style menus.
const BUTTON_CLASS = {
  pill: "inline-flex items-center gap-2 px-4 py-2 bg-white/60 dark:bg-neutral-900/50 backdrop-blur-lg rounded-full border border-neutral-200/60 dark:border-neutral-700/50 text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 text-sm font-medium transition-all hover:bg-white/80 dark:hover:bg-neutral-900/70 shadow-sm",
  text: "inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors",
};

const ANCHOR_MOTION = {
  bottom: "origin-top data-closed:-translate-y-1.5",
  "bottom start": "origin-top-left data-closed:-translate-y-1.5",
};

/** Target language picker; also switches the translator when several are configured. */
export function LanguagePicker({ anchor = "bottom start", variant = "text" }: LanguagePickerProps) {
  const { selectedLanguage, selectedProvider, supportedProviders } = useTranslate();

  return (
    <Popover>
      <PopoverButton className={BUTTON_CLASS[variant]}>
        <GlobeIcon size={variant === "pill" ? 16 : 14} className={variant === "text" ? "-ml-0.5" : undefined} />
        <span>{selectedLanguage?.name || "Select Language"}</span>
        {supportedProviders.length > 1 && selectedProvider && (
          <span className="text-neutral-400 dark:text-neutral-500">· {selectedProvider.name}</span>
        )}
      </PopoverButton>
      <PopoverPanel
        transition
        anchor={anchor}
        className={cn(PANEL_CLASS, ANCHOR_MOTION[anchor], "flex w-72 flex-col overflow-hidden [--anchor-gap:4px]")}
      >
        <PickerPanel />
      </PopoverPanel>
    </Popover>
  );
}

// Mounted only while open, so the search query starts empty each time.
function PickerPanel() {
  const close = useClose();
  const { provider, targetLang, selectedFile, supportedProviders, supportedLanguages, setProvider, setTargetLang } =
    useTranslate();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const languages = q
    ? supportedLanguages.filter((language) =>
        [language.name, language.nativeName, language.code].some((value) => value?.toLowerCase().includes(q)),
      )
    : supportedLanguages;

  const select = (code: string | null) => {
    if (!code) return;
    setTargetLang(code);
    close();
  };

  return (
    <>
      {supportedProviders.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Translator"
          className="mb-1 flex gap-0.5 rounded-lg bg-neutral-100/70 p-0.5 dark:bg-white/5"
        >
          {supportedProviders.map((p) => {
            // A selected file pins the choice to translators that accept its type.
            const unsupported = !!selectedFile && !fileMatchesTypeList(selectedFile.name, selectedFile.type, p.files);
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === provider}
                disabled={unsupported}
                title={unsupported ? `${p.name} can't translate this file type` : p.description}
                onClick={() => setProvider(p.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  p.id === provider
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
                )}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      <Combobox value={targetLang} onChange={select}>
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-neutral-100/70 px-2 py-1.5 dark:bg-white/5">
          <Search size={13} className="shrink-0 text-neutral-400" />
          <ComboboxInput
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search languages…"
            aria-label="Search languages"
            className="w-full bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-200"
          />
        </div>

        <ComboboxOptions static className="max-h-72 overflow-y-auto scrollbar-thin">
          {languages.map((language) => (
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
          {languages.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {q ? `No languages match “${query.trim()}”` : "No languages available"}
            </div>
          )}
        </ComboboxOptions>
      </Combobox>
    </>
  );
}
