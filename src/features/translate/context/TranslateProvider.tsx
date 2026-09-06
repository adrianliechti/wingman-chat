import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getConfig } from "@/shared/config";
import { TranslationSession } from "../lib/translationSession";
import { styleOptions, supportedFiles, supportedLanguages, TranslateContext, toneOptions } from "./TranslateContext";

export function TranslateProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const config = getConfig();
    return new TranslationSession(config.client, config.translator ?? undefined);
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.dispose(), [session]);
  const languages = supportedLanguages();

  return (
    <TranslateContext
      value={{
        ...state,
        supportedLanguages: languages,
        selectedLanguage: languages.find((language) => language.code === state.targetLang),
        supportedFiles: supportedFiles(),
        toneOptions: toneOptions(),
        styleOptions: styleOptions(),
        setSourceText: (sourceText) => session.update({ sourceText }),
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
