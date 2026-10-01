import mime from "mime";
import { createContext } from "react";
import { getConfig } from "@/shared/config";
import { fileMatchesTypeList } from "@/shared/lib/fileTypes";
import { lookupContentType } from "@/shared/lib/utils";

// Types
export interface SupportedFile {
  ext: string;
  mime: string;
}

export interface Language {
  code: string;
  name: string;
  /** The language's name in itself (e.g. "Deutsch"), when it differs. */
  nativeName?: string;
}

export interface TranslatorProvider {
  id: string;
  name: string;
  description?: string;
  /** Resolved file types (provider override or translator-wide). */
  files: string[];
  /** Resolved language codes (provider override or translator-wide). */
  languages: string[];
}

export interface ToneOption {
  value: string;
  label: string;
}

export interface StyleOption {
  value: string;
  label: string;
}

export interface TranslateContextType {
  // State
  sourceText: string;
  translatedText: string;
  provider: string;
  targetLang: string;
  tone: string;
  style: string;
  isLoading: boolean;
  selectedFile: File | null;
  translatedFileUrl: string | null;
  translatedFileName: string | null;
  error: string | null;

  // Data
  selectedProvider: TranslatorProvider | undefined;
  supportedProviders: TranslatorProvider[];
  selectedLanguage: Language | undefined;
  supportedFiles: SupportedFile[];
  supportedLanguages: Language[];
  toneOptions: ToneOption[];
  styleOptions: StyleOption[];

  // Actions
  setSourceText: (text: string) => void;
  setProvider: (providerId: string) => void;
  setTargetLang: (langCode: string) => void;
  setTone: (tone: string) => void;
  setStyle: (style: string) => void;
  performTranslate: () => Promise<void>;
  handleReset: () => void;
  selectFile: (file: File) => void;
  clearFile: () => void;
}

export const TranslateContext = createContext<TranslateContextType | undefined>(undefined);

export const supportedProviders = (): TranslatorProvider[] => {
  try {
    const translator = getConfig().translator;
    if (!translator) return [];
    return (translator.providers ?? []).map(({ id, name, description, files, languages }) => ({
      id,
      name: name || id,
      description,
      files: files ?? translator.files ?? [],
      languages: languages ?? translator.languages,
    }));
  } catch {
    return [];
  }
};

// Without providers, the translator-wide lists apply.
const providerLists = (providerId?: string): { files: string[]; languages: string[] } => {
  try {
    const translator = getConfig().translator;
    if (!translator) return { files: [], languages: [] };
    const provider = supportedProviders().find((p) => p.id === providerId);
    return provider ?? { files: translator.files ?? [], languages: translator.languages };
  } catch {
    // Config is not loaded yet
    return { files: [], languages: [] };
  }
};

const displayName = (code: string, locale: string): string | undefined => {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code);
  } catch {
    return undefined;
  }
};

export const supportedLanguages = (providerId?: string): Language[] =>
  providerLists(providerId).languages.map((code) => {
    const name = displayName(code, "en") || code.toUpperCase();
    const nativeName = displayName(code, code);
    return { code, name, nativeName: nativeName && nativeName !== name ? nativeName : undefined };
  });

/** Keeps `current` when available, else prefers English, else the first language. */
export const pickLanguage = (codes: string[], current?: string): string =>
  (current && codes.includes(current) ? current : codes.includes("en") ? "en" : codes[0]) ?? "";

// translator.files entries may be extensions (".pdf") or MIME types ("application/pdf").
export const supportedFiles = (providerId?: string): SupportedFile[] =>
  providerLists(providerId).files.map((entry) => {
    if (entry.startsWith(".")) {
      return { ext: entry, mime: lookupContentType(entry) ?? "" };
    }
    const ext = mime.getExtension(entry);
    return { ext: ext ? `.${ext}` : entry, mime: entry };
  });

export const isSupportedFile = (file: File, providerId?: string): boolean =>
  fileMatchesTypeList(file.name, file.type, providerLists(providerId).files);

export const toneOptions = (): ToneOption[] => [
  { value: "", label: "Default" },
  { value: "enthusiastic", label: "Enthusiastic" },
  { value: "friendly", label: "Friendly" },
  { value: "confident", label: "Confident" },
  { value: "diplomatic", label: "Diplomatic" },
];

export const styleOptions = (): StyleOption[] => [
  { value: "", label: "Default" },
  { value: "simple", label: "Simple" },
  { value: "business", label: "Business" },
  { value: "academic", label: "Academic" },
  { value: "casual", label: "Casual" },
];
