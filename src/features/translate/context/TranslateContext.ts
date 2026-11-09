import { createContext } from "react";
import type { Language, SelectOption, SupportedFile, TranslatorProvider } from "../lib/languages";
import type { Translation } from "../types/translate";

/** Composer values: the open text job's, or the unsaved draft's before a job exists. */
export interface TranslateDraft {
  sourceText: string;
  targetLang: string;
  provider: string;
  formality: string;
  style: string;
}

export interface TranslateContextType {
  translations: Translation[];
  isLoaded: boolean;
  /** The open job, or null while composing a new text. */
  active: Translation | null;
  draft: TranslateDraft;

  providers: TranslatorProvider[];
  /** Languages of the draft's translator. */
  languages: Language[];
  /** File types the draft's translator accepts. */
  files: SupportedFile[];
  /** File types any translator accepts, for pickers and drop zones. */
  acceptedFiles: SupportedFile[];
  formalityOptions: SelectOption[];
  styleOptions: SelectOption[];

  setSourceText: (text: string) => void;
  setTargetLang: (code: string) => void;
  setProvider: (id: string) => void;
  setFormality: (formality: string) => void;
  setStyle: (style: string) => void;
  /** Translate the composer's text now instead of after the typing pause. */
  translateNow: () => void;

  /** Start one file job per document; the first becomes the open job. */
  addFiles: (files: File[]) => Promise<void>;
  open: (id: string) => void;
  newTranslation: () => void;
  remove: (id: string) => Promise<void>;
  retry: (id: string) => void;
  cancel: (id: string) => void;

  /** Rewrite a job's result text with a free instruction. */
  refine: (id: string, instruction: string) => Promise<void>;
  /** Back to the translator's output (with the chosen formality and style). */
  revertRefinement: (id: string) => void;
  replaceResult: (id: string, text: string) => void;
}

export const TranslateContext = createContext<TranslateContextType | undefined>(undefined);
