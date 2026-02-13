import { useContext } from "react";
import { TranslateContext } from '@/features/translate/context/TranslateContext';

export function useTranslate() {
  const context = useContext(TranslateContext);
  if (context === undefined) {
    throw new Error("useTranslate must be used within a TranslateProvider");
  }
  return context;
}
