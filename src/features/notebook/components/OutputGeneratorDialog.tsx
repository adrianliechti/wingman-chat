import { Listbox, Transition } from "@headlessui/react";
import { AudioLines, BarChart3, Check, ChevronsUpDown, Presentation, Sparkles, Table2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getConfig } from "@/shared/config";
import type { Style } from "../lib/styles";
import { infographicStyles, podcastStyles, reportStyles, slideStyles } from "../lib/styles";
import type { OutputType } from "../types/notebook";

// ── Types ──────────────────────────────────────────────────────────────

export interface GeneratorOptions {
  styleId?: string;
  language?: string;
  slideCount?: number;
  instructions?: string;
}

interface OutputGeneratorDialogProps {
  open: boolean;
  /** The output type to configure. Must be a style-driven type. */
  type: OutputType;
  onClose: () => void;
  onGenerate: (type: OutputType, options: GeneratorOptions) => void;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_LANGUAGES = ["en", "de", "fr", "es", "it", "pt", "nl", "ja", "zh", "ko"];

interface LanguageOption {
  code: string;
  name: string;
}

const AUTO_LANGUAGE: LanguageOption = { code: "auto", name: "Auto — match sources" };

function resolveLanguages(): LanguageOption[] {
  const codes = getConfig().translator?.languages ?? DEFAULT_LANGUAGES;
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    displayNames = null;
  }
  return codes.map((code) => ({
    code,
    name: displayNames?.of(code) ?? code.toUpperCase(),
  }));
}

const SLIDE_COUNT_MIN = 3;
const SLIDE_COUNT_MAX = 30;
const SLIDE_COUNT_DEFAULT = 10;
type SlidePreset = "short" | "standard" | "long" | "custom";
const SLIDE_PRESETS: { id: SlidePreset; label: string; count: number | null }[] = [
  { id: "short", label: "Short", count: 6 },
  { id: "standard", label: "Standard", count: 10 },
  { id: "long", label: "Long", count: 16 },
  { id: "custom", label: "Custom", count: null },
];

const TYPE_META: Record<
  string,
  {
    icon: typeof Presentation;
    title: string;
    placeholder: string;
    styles: { getAll(): Style[] };
    /** Show large description cards instead of compact tiles. */
    descriptionCards?: boolean;
  }
> = {
  slides: {
    icon: Presentation,
    title: "Generate Slides",
    placeholder: "Describe the slide deck you want to create…",
    styles: slideStyles,
    descriptionCards: true,
  },
  podcast: {
    icon: AudioLines,
    title: "Generate Podcast",
    placeholder: "What should the hosts focus on in this episode…",
    styles: podcastStyles,
    descriptionCards: true,
  },
  report: {
    icon: Table2,
    title: "Generate Report",
    placeholder: "Describe the report you want to create…",
    styles: reportStyles,
    descriptionCards: true,
  },
  infographic: {
    icon: BarChart3,
    title: "Generate Infographic",
    placeholder: "Describe the infographic you want to create…",
    styles: infographicStyles,
  },
};

// ── Component ──────────────────────────────────────────────────────────

export function OutputGeneratorDialog({ open, type, onClose, onGenerate }: OutputGeneratorDialogProps) {
  const meta = TYPE_META[type];
  const styles = useMemo(() => meta?.styles.getAll() ?? [], [meta]);
  const languages = useMemo(resolveLanguages, []);
  const allLanguages = useMemo(() => [AUTO_LANGUAGE, ...languages], [languages]);

  const [styleId, setStyleId] = useState<string>("");
  const [selectedLang, setSelectedLang] = useState<LanguageOption>(AUTO_LANGUAGE);
  const [preset, setPreset] = useState<SlidePreset>("standard");
  const [customCount, setCustomCount] = useState(SLIDE_COUNT_DEFAULT);
  const [instructions, setInstructions] = useState("");

  const showSlideCount = type === "slides";
  const showDescriptionCards = meta?.descriptionCards ?? false;
  const showStylePicker = styles.length > 0;

  // Reset state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStyleId(styles[0]?.id ?? "");
      setSelectedLang(AUTO_LANGUAGE);
      setPreset("standard");
      setCustomCount(SLIDE_COUNT_DEFAULT);
      setInstructions("");
    }
  }, [open, styles]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const resolvedCount = (): number => {
    const p = SLIDE_PRESETS.find((x) => x.id === preset);
    return p?.count ?? customCount;
  };

  const handleGenerate = () => {
    const opts: GeneratorOptions = {
      styleId: styleId || undefined,
      language: selectedLang.code === "auto" ? undefined : selectedLang.name,
      instructions: instructions.trim() || undefined,
    };
    if (showSlideCount) opts.slideCount = resolvedCount();
    onGenerate(type, opts);
    onClose();
  };

  if (!meta) return null;

  const Icon = meta.icon;

  return (
    <Transition show={open} as={Fragment}>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm cursor-default"
          />
        </Transition.Child>

        {/* Panel */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[42rem] max-w-[calc(100vw-2rem)] bg-white/90 dark:bg-neutral-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-neutral-200/80 dark:border-neutral-700/80 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200/60 dark:border-neutral-800/60">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <Icon size={14} className="text-neutral-600 dark:text-neutral-400" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{meta.title}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* ── Style: description cards (podcast / report) ── */}
              {showStylePicker && showDescriptionCards && (
                <div>
                  <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Format</p>
                  <div className="grid grid-cols-3 gap-2">
                    {styles.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyleId(s.id)}
                        className={`relative text-left p-3 rounded-lg border transition-colors ${
                          styleId === s.id
                            ? "border-blue-500/60 dark:border-blue-500/50 bg-blue-50/70 dark:bg-blue-950/30"
                            : "border-neutral-300/50 dark:border-neutral-700/50 bg-white/50 dark:bg-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/80 backdrop-blur-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-xs font-semibold ${
                              styleId === s.id
                                ? "text-blue-700 dark:text-blue-300"
                                : "text-neutral-700 dark:text-neutral-300"
                            }`}
                          >
                            {s.label}
                          </p>
                          {styleId === s.id && (
                            <Check size={12} className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
                          )}
                        </div>
                        {s.description && (
                          <p
                            className={`text-[10px] leading-snug mt-1 ${
                              styleId === s.id
                                ? "text-blue-600/70 dark:text-blue-400/70"
                                : "text-neutral-500 dark:text-neutral-500"
                            }`}
                          >
                            {s.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Style: compact tile grid (slides / infographic) ── */}
              {showStylePicker && !showDescriptionCards && (
                <div>
                  <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
                    {type === "infographic" ? "Visual style" : "Theme"}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {styles.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyleId(s.id)}
                        className={`relative flex items-center justify-between px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                          styleId === s.id
                            ? "border-blue-500/60 dark:border-blue-500/50 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-medium"
                            : "border-neutral-300/50 dark:border-neutral-700/50 bg-white/50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800/80 backdrop-blur-sm"
                        }`}
                      >
                        {s.label}
                        {styleId === s.id && (
                          <Check size={11} className="shrink-0 text-blue-500 dark:text-blue-400" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Language ── */}
              <div>
                <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Language</p>
                <Listbox value={selectedLang} onChange={setSelectedLang} by="code">
                  <Listbox.Button className="relative w-full rounded-lg bg-white/50 dark:bg-neutral-800/50 py-2.5 pl-3 pr-10 text-left text-sm border border-neutral-300/50 dark:border-neutral-700/50 focus-visible:ring-2 focus-visible:ring-blue-500 data-[headlessui-state=open]:ring-2 data-[headlessui-state=open]:ring-blue-500 backdrop-blur-sm transition-colors">
                    <span className="block truncate text-neutral-800 dark:text-neutral-200">
                      {selectedLang.name}
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
                      <ChevronsUpDown size={14} className="text-neutral-400" aria-hidden="true" />
                    </span>
                  </Listbox.Button>
                  <Transition
                    as={Fragment}
                    leave="transition ease-in duration-100"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <Listbox.Options
                      anchor="bottom"
                      className="mt-1 w-(--button-width) max-h-56 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/90 dark:bg-neutral-800/90 p-1 backdrop-blur-xl text-sm z-[100] transition duration-100 ease-in data-leave:data-closed:opacity-0"
                    >
                      {allLanguages.map((lang) => (
                        <Listbox.Option
                          key={lang.code}
                          value={lang}
                          className="group relative cursor-pointer select-none py-2 pl-9 pr-3 rounded-lg text-neutral-800 dark:text-neutral-200 data-focus:bg-neutral-200 dark:data-focus:bg-neutral-700/80"
                        >
                          <span className="block truncate font-normal group-data-selected:font-semibold">
                            {lang.name}
                          </span>
                          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-blue-600 dark:text-blue-400 group-data-selected:visible invisible">
                            <Check size={14} aria-hidden="true" />
                          </span>
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </Transition>
                </Listbox>
              </div>

              {/* ── Slide count (slides only) ── */}
              {showSlideCount && (
                <div>
                  <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
                    Number of slides
                  </p>
                  <div className="flex rounded-lg overflow-hidden border border-neutral-300/50 dark:border-neutral-700/50">
                    {SLIDE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreset(p.id)}
                        className={`flex-1 py-2 px-2 text-xs font-medium transition-colors truncate ${
                          preset === p.id
                            ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                            : "bg-white/50 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                        }`}
                      >
                        {p.label}
                        {p.count !== null && (
                          <span className="ml-1 font-normal opacity-60 text-[10px]">({p.count})</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {preset === "custom" && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="range"
                        min={SLIDE_COUNT_MIN}
                        max={SLIDE_COUNT_MAX}
                        value={customCount}
                        onChange={(e) => setCustomCount(Number(e.target.value))}
                        className="flex-1 accent-neutral-600 dark:accent-neutral-400"
                      />
                      <input
                        type="number"
                        min={SLIDE_COUNT_MIN}
                        max={SLIDE_COUNT_MAX}
                        value={customCount}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) {
                            setCustomCount(Math.min(SLIDE_COUNT_MAX, Math.max(SLIDE_COUNT_MIN, Math.round(n))));
                          }
                        }}
                        className="w-14 px-2 py-1.5 text-xs text-center rounded-lg bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/50 dark:border-neutral-700/50 text-neutral-800 dark:text-neutral-200 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 backdrop-blur-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── Instructions ── */}
              <div>
                <p className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Instructions <span className="font-normal opacity-60">(optional)</span>
                </p>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={meta.placeholder}
                  rows={3}
                  className="w-full rounded-lg bg-white/50 dark:bg-neutral-800/50 py-2.5 px-3 text-sm border border-neutral-300/50 dark:border-neutral-700/50 text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 backdrop-blur-sm resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-300 transition-colors"
              >
                <Sparkles size={12} />
                Generate
              </button>
            </div>
          </div>
        </Transition.Child>
      </div>
    </Transition>
  );
}
