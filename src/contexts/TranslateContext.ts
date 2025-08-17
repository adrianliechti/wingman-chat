import { createContext } from "react";
import { getConfig } from "../config";
import { lookupContentType } from "../lib/utils";

// Types
export interface SupportedFile {
  ext: string;
  mime: string;
}

export interface Language {
  code: string;
  name: string;
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
  targetLang: string;
  tone: string;
  style: string;
  isLoading: boolean;
  selectedFile: File | null;
  translatedFileUrl: string | null;
  translatedFileName: string | null;
  
  // Data
  selectedLanguage: Language | undefined;
  supportedFiles: SupportedFile[];
  supportedLanguages: Language[];
  toneOptions: ToneOption[];
  styleOptions: StyleOption[];
  
  // Actions
  setSourceText: (text: string) => void;
  setTargetLang: (langCode: string) => void;
  setTone: (tone: string) => void;
  setStyle: (style: string) => void;
  performTranslate: (langCode?: string, textToTranslate?: string, tone?: string, style?: string) => Promise<void>;
  handleReset: () => void;
  selectFile: (file: File) => void;
  clearFile: () => void;
}

export const TranslateContext = createContext<TranslateContextType | undefined>(undefined);

export const supportedLanguages = (): Language[] => {
  try {
    const config = getConfig();
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    
    return config.translator.languages.map(code => ({
      code,
      name: displayNames.of(code) || code.toUpperCase()
    }));
  } catch {
    // Return empty array if config is not loaded yet
    return [];
  }
};

export const supportedFiles = (): SupportedFile[] => {
  try {
    const config = getConfig();
    const fileExtensions = config.translator.files || [];
    return fileExtensions.map(ext => ({
      ext,
      mime: lookupContentType(ext)
    }));
  } catch {
    // Return empty array if config is not loaded yet
    return [];
  }
};

export const toneOptions = (): ToneOption[] => [
  { value: 'default', label: 'Default' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'confident', label: 'Confident' },
  { value: 'diplomatic', label: 'Diplomatic' },
];

export const styleOptions = (): StyleOption[] => [
  { value: 'default', label: 'Default' },
  { value: 'simple', label: 'Simple' },
  { value: 'business', label: 'Business' },
  { value: 'academic', label: 'Academic' },
  { value: 'casual', label: 'Casual' },
];
