import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { getConfig } from "../config";
import { TranslateContext, supportedLanguages, supportedFiles } from './TranslateContext';
import type { TranslateContextType } from './TranslateContext';

interface TranslateProviderProps {
  children: ReactNode;
}

export function TranslateProvider({ children }: TranslateProviderProps) {
  const config = getConfig();
  const client = config.client;

  // State
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [translatedFileUrl, setTranslatedFileUrl] = useState<string | null>(null);
  const [translatedFileName, setTranslatedFileName] = useState<string | null>(null);

  // Refs for stable references
  const sourceTextRef = useRef(sourceText);
  const targetLangRef = useRef(targetLang);

  // Update refs when state changes
  useEffect(() => {
    sourceTextRef.current = sourceText;
  }, [sourceText]);

  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);

  // Derived state
  const selectedLanguage = supportedLanguages().find(l => l.code === targetLang);

  // Actions with stable references
  const performTranslate = useCallback(async (langCode?: string, textToTranslate?: string) => {
    const langToUse = langCode ?? targetLangRef.current;
    
    // Handle file translation if a file is selected
    if (selectedFile) {
      setIsLoading(true);
      try {
        const result = await client.translate(langToUse, selectedFile);
        
        // Check the return type and handle accordingly
        if (typeof result === 'string') {
          // If string, render the output directly in the translated content
          setTranslatedText(result);
          // Clear any previous file download state
          setTranslatedFileUrl(null);
          setTranslatedFileName(null);
        } else if (result instanceof Blob) {
          // If blob, allow to download like currently
          // Create download URL
          const url = URL.createObjectURL(result);
          
          // Generate filename with language suffix
          const originalName = selectedFile.name;
          const lastDotIndex = originalName.lastIndexOf('.');
          const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
          const extension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '';
          const translatedFileName = `${nameWithoutExt}_${langToUse}${extension}`;
          
          // Set download URL and filename for display
          setTranslatedFileUrl(url);
          setTranslatedFileName(translatedFileName);
          // Clear any previous text translation
          setTranslatedText("");
          
          // Auto-download the file
          const link = document.createElement('a');
          link.href = url;
          link.download = translatedFileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } catch (err) {
        console.error('File translation failed:', err);
        // Could add error state here if needed
      } finally {
        setIsLoading(false);
      }
      return;
    }
    
    // Handle text translation
    const textToUse = textToTranslate ?? sourceTextRef.current;

    if (!textToUse.trim()) {
      setTranslatedText("");
      return;
    }

    setIsLoading(true);
    setTranslatedText("");

    try {
      const result = await client.translate(langToUse, textToUse);
      if (typeof result === 'string') {
        setTranslatedText(result);
      }
    } catch (err) {
      setTranslatedText(err instanceof Error ? err.message : "An unknown error occurred during translation.");
    } finally {
      setIsLoading(false);
    }
  }, [client, selectedFile]);

  const handleReset = useCallback(() => {
    setSourceText("");
    setTranslatedText("");
    setSelectedFile(null);
    setTranslatedFileUrl(null);
    setTranslatedFileName(null);
  }, []);

  const handleSetTargetLang = useCallback(async (newLangCode: string) => {
    setTargetLang(newLangCode);
    
    // If there's a selected file, clear translation results to show candidate state
    if (selectedFile) {
      setTranslatedFileUrl(null);
      setTranslatedFileName(null);
      setTranslatedText("");  // Also clear text translation for files
    }
    
    // Automatically translate with new language if there's source text (but not if file is selected)
    if (sourceTextRef.current.trim() && !selectedFile) {
      await performTranslate(newLangCode, sourceTextRef.current);
    }
  }, [performTranslate, selectedFile]);

  // Auto-translate effect (3 second delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sourceText.trim() && !selectedFile) {
        performTranslate(targetLang, sourceText);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [sourceText, targetLang, performTranslate, selectedFile]);

  const selectFile = useCallback((file: File) => {
    setSelectedFile(file);
    // Clear any previous file translation results
    setTranslatedFileUrl(null);
    setTranslatedFileName(null);
    // Clear text translation output
    setTranslatedText("");
  }, []);

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setTranslatedFileUrl(null);
    setTranslatedFileName(null);
    setTranslatedText("");  // Clear translated text when clearing file
  }, []);

  const contextValue: TranslateContextType = {
    // State
    sourceText,
    translatedText,
    targetLang,
    isLoading,
    selectedFile,
    translatedFileUrl,
    translatedFileName,
    
    // Data
    supportedLanguages: supportedLanguages(),
    selectedLanguage,
    supportedFiles: supportedFiles(),
    
    // Actions
    setSourceText,
    setTargetLang: handleSetTargetLang,
    performTranslate,
    handleReset,
    selectFile,
    clearFile,
  };

  return (
    <TranslateContext.Provider value={contextValue}>
      {children}
    </TranslateContext.Provider>
  );
}
