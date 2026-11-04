import mime from "mime";
import { getConfig } from "@/shared/config";
import { fileMatchesTypeList } from "@/shared/lib/fileTypes";
import { lookupContentType } from "@/shared/lib/utils";

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

export interface SelectOption {
  value: string;
  label: string;
}

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

/** English name of a language code ("de" → "German"), the code itself when unknown. */
export const languageName = (code: string): string => displayName(code, "en") || code.toUpperCase();

export const supportedLanguages = (providerId?: string): Language[] =>
  providerLists(providerId).languages.map((code) => {
    const name = languageName(code);
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

/** The first provider that accepts the file, preferring `current`. */
export const providerForFile = (file: File, current: string): string | undefined => {
  const providers = supportedProviders();
  if (providers.length === 0) return isSupportedFile(file) ? "" : undefined;
  if (isSupportedFile(file, current)) return current;
  return providers.find((provider) => fileMatchesTypeList(file.name, file.type, provider.files))?.id;
};

/** Register of address: the one control every translation service offers (DeepL formality, Google formal/casual). */
export const formalityOptions = (): SelectOption[] => [
  { value: "", label: "As written" },
  { value: "formal", label: "Formal" },
  { value: "informal", label: "Informal" },
];

/** How the translation reads; orthogonal to formality, so the two combine without conflict. */
export const styleOptions = (): SelectOption[] => [
  { value: "", label: "As written" },
  { value: "plain", label: "Plain language" },
  { value: "professional", label: "Professional" },
  { value: "natural", label: "Natural" },
  { value: "technical", label: "Technical" },
];

/** Keeps a stored option value only when it is still offered. */
export const knownOption = (options: SelectOption[], value: string | undefined): string =>
  value && options.some((option) => option.value === value) ? value : "";
