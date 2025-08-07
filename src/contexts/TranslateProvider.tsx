import { useState, useCallback, useRef, useEffect, ReactNode } from "react";
import { getConfig } from "../config";
import { TranslateContext, TranslateContextType, supportedLanguages, supportedFiles } from './TranslateContext';

interface TranslateProviderProps {
  children: ReactNode;
}

export function TranslateProvider({ children }: TranslateProviderProps) {
  const config = getConfig();
  const client = config.client;

  // State
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [teachingContent, setTeachingContent] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTeaching, setIsLoadingTeaching] = useState(false);
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
        
        // Generate teaching content if we have both source and translation
        if (textToUse.trim() && result.trim()) {
          setIsLoadingTeaching(true);
          setTeachingContent("");
          
          try {
            const messages = [
              { role: 'user' as const, content: textToUse },
              { role: 'assistant' as const, content: result }
            ];
            
            const selectedLang = supportedLanguages().find(l => l.code === langToUse);
            const languageName = selectedLang?.name || langToUse;
            
            const teachingResult = await client.translateAndTeach('gpt-4o', messages, languageName);
            setTeachingContent(teachingResult);
          } catch (teachingErr) {
            console.error('Teaching content generation failed:', teachingErr);
            setTeachingContent("");
          } finally {
            setIsLoadingTeaching(false);
          }
        }
      }
    } catch (err) {
      setTranslatedText(err instanceof Error ? err.message : "An unknown error occurred during translation.");
      setTeachingContent("");
    } finally {
      setIsLoading(false);
    }
  }, [client, selectedFile]);

  const handleReset = useCallback(() => {
    setSourceText("");
    setTranslatedText("");
    setTeachingContent("");
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
      setTeachingContent("");
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
    setTeachingContent("");
  }, []);

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setTranslatedFileUrl(null);
    setTranslatedFileName(null);
    setTranslatedText("");  // Clear translated text when clearing file
    setTeachingContent("");
  }, []);

  const contextValue: TranslateContextType = {
    // State
    sourceText,
    translatedText,
    teachingContent,
    targetLang,
    isLoading,
    isLoadingTeaching,
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
