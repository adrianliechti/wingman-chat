import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getConfig } from "@/shared/config";
import { TranslationSession } from "../lib/translationSession";
import {
  pickLanguage,
  styleOptions,
  supportedFiles,
  supportedLanguages,
  supportedProviders,
  TranslateContext,
  toneOptions,
} from "./TranslateContext";

export function TranslateProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const config = getConfig();
    const provider = supportedProviders()[0]?.id ?? "";
    const targetLang = pickLanguage(supportedLanguages(provider).map((language) => language.code));
    return new TranslationSession(config.client, config.translator ?? undefined, { provider, targetLang });
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.dispose(), [session]);
  const providers = supportedProviders();
  const languages = supportedLanguages(state.provider);

  return (
    <TranslateContext
      value={{
        ...state,
        supportedProviders: providers,
        selectedProvider: providers.find((provider) => provider.id === state.provider),
        supportedLanguages: languages,
        selectedLanguage: languages.find((language) => language.code === state.targetLang),
        supportedFiles: supportedFiles(state.provider),
        toneOptions: toneOptions(),
        styleOptions: styleOptions(),
        setSourceText: (sourceText) => session.update({ sourceText }),
        // Keep the target language when the new provider offers it.
        setProvider: (provider) =>
          session.update({
            provider,
            targetLang: pickLanguage(
              supportedLanguages(provider).map((language) => language.code),
              state.targetLang,
            ),
          }),
        setTargetLang: (targetLang) => session.update({ targetLang }),
        setTone: (tone) => session.update({ tone }),
        setStyle: (style) => session.update({ style }),
        selectFile: (selectedFile) => session.update({ selectedFile }),
        clearFile: () => session.update({ selectedFile: null }),
        performTranslate: session.translate,
        handleReset: session.reset,
      }}
    >
      {children}
    </TranslateContext>
  );
}
