// Context

export type {
  Language,
  StyleOption,
  SupportedFile,
  ToneOption,
  TranslateContextType,
} from "./context/TranslateContext";
export {
  styleOptions,
  supportedFiles,
  supportedLanguages,
  TranslateContext,
  toneOptions,
} from "./context/TranslateContext";
export { TranslateProvider } from "./context/TranslateProvider";

// Hooks
export { useTranslate } from "./hooks/useTranslate";

// Pages
export { TranslatePage } from "./pages/TranslatePage";
